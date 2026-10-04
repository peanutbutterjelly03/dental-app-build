// Downloads EVERY student's chart data for this device, in the background, so a
// chart opens offline even if nobody ever opened it here (records.ts holds it).
//
// Walks GET /api/offline/bundle one page of students at a time (~100 students and
// everything under them per request), saving each page as it arrives. It
//   - resumes where it stopped if the tab closed or the connection dropped
//     (the position is saved after every page),
//   - does nothing when the server reports nothing has changed since the last
//     complete run (one cheap request on each sign-in),
//   - drops, at the end of a complete run, whatever the server no longer has,
//   - saves the lists the pages themselves read (student list, charting queue)
//     so there is a way to REACH those charts offline, not only to open them.
//
// Only for the people who read clinical records (the same roles as the route).
import { apiClient, ApiError } from '../api/client';
import { loadUserCache } from './authCache';
import { putOfflineRecords, getOfflineMeta, putOfflineMeta, deleteOfflineRecordsNotInRun, type OfflineRecord } from './db';
import { RECORD_RESOURCES, toOfflineRecord } from './records';
import { mintOperationId } from './syncEnvelope';

const CLINICAL_READERS = ['system_admin', 'dentist', 'dental_aide'];
const PAGE_SIZE = 100;
/** A half-finished run older than this starts over rather than resuming. */
const RESUME_WITHIN_MS = 12 * 60 * 60 * 1000;
/** The lists the Student Records and Dental Charts screens read, exactly as they
 *  ask for them, so being offline does not strand the way INTO a chart. */
const SCREEN_LISTS = ['/stats/student-rows', '/stats/student-nav', '/student-iptrs', '/treatments', '/appointments', '/schools', '/dentists'];

interface SyncMeta {
  key: string;
  runId: string;
  cursor: string | null;
  done: number;
  total: number | null;
  startedAt: number;
  completedAt: number | null;
  lastChange: string | null;
}

type Bundle = Record<string, unknown[]> & { next: string | null; total?: number };

export interface OfflineDataStatus {
  /** idle: nothing downloaded yet. syncing. paused: stopped part way, resumes by itself. ready. */
  state: 'idle' | 'syncing' | 'paused' | 'ready';
  done: number;
  total: number | null;
  completedAt: number | null;
  /** Why the last attempt stopped, in words a person can act on. Null when it did not fail. */
  error: string | null;
}

let status: OfflineDataStatus = { state: 'idle', done: 0, total: null, completedAt: null, error: null };
const listeners = new Set<() => void>();
export const getOfflineDataStatus = () => status;
export function subscribeOfflineData(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(patch: Partial<OfflineDataStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

/** After sign-out: nothing is downloaded any more. */
export function resetOfflineDataStatus(): void {
  publish({ state: 'idle', done: 0, total: null, completedAt: null, error: null });
}

const metaKey = (owner: string) => `${owner}|sync`;

/** What a freshly loaded page should say before (or without) a run of its own.
 *  Only fills in a status that does not exist yet: once a run in THIS session has
 *  said something (syncing, paused with a reason, ready), a screen that merely
 *  mounted must not wipe it. A first download that failed before saving any
 *  progress has no saved record at all, so resetting to "nothing downloaded"
 *  here would silently erase the reason it failed. */
export async function loadOfflineDataStatus(): Promise<void> {
  const owner = loadUserCache()?.id;
  if (!owner || status.state !== 'idle') return;
  try {
    const meta = await getOfflineMeta<SyncMeta>(metaKey(owner));
    if (!meta) publish({ state: 'idle', done: 0, total: null, completedAt: null, error: null });
    else if (meta.completedAt) publish({ state: 'ready', done: meta.done, total: meta.total ?? meta.done, completedAt: meta.completedAt, error: null });
    else publish({ state: 'paused', done: meta.done, total: meta.total, completedAt: null });
  } catch {
    /* storage unavailable: leave the status as it is */
  }
}

/** The reason a download stopped, as something a person can act on. */
function reasonFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'The server does not have the offline download yet. It needs the latest update.';
    if (err.status === 401 || err.status === 403) return 'This account is not allowed to download, or the session ended. Sign in again.';
    return `The server could not send it (error ${err.status}).`;
  }
  return 'The connection dropped or timed out.';
}

/** One page, but never wait forever: a request that hangs on a poor connection
 *  must not leave the sync stuck "running" for the rest of the session. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
const PAGE_TIMEOUT_MS = 60_000;

let running = false;

/** `force` skips the "nothing changed since the last complete run" shortcut: for
 *  the person pressing "Try again". */
export async function startBulkSync(force = false): Promise<void> {
  const user = loadUserCache();
  if (running || !navigator.onLine || !user || !CLINICAL_READERS.includes(user.role)) return;
  running = true;
  const owner = user.id;
  const key = metaKey(owner);
  try {
    const previous = await getOfflineMeta<SyncMeta>(key);
    // When anything that is downloaded last changed (NOT /stats/last-change: every sign-in moves that).
    // A FAILED check is not an answer. The connection has often only just come back
    // (this also runs on the `online` event), and treating "could not ask" as "changed"
    // would re-download every student on a flicker. With a complete copy already on the
    // device, keep it and look again at the next sign-in or reconnect.
    let lastChange: string | null = null;
    let checkFailed = false;
    try {
      lastChange = (await apiClient.get<{ at: string | null }>('/offline/version')).at ?? null;
    } catch {
      checkFailed = true;
    }
    if (checkFailed && !force && previous?.completedAt) {
      publish({ state: 'ready', done: previous.done, total: previous.total ?? previous.done, completedAt: previous.completedAt, error: null });
      return;
    }

    // Nothing that is downloaded has changed since the last complete run: already current.
    // (An answer of null means the server has no change history to compare, so download.)
    if (!force && previous?.completedAt && lastChange !== null && previous.lastChange === lastChange) {
      publish({ state: 'ready', done: previous.done, total: previous.total ?? previous.done, completedAt: previous.completedAt });
      return;
    }

    const resumable = !!previous && !previous.completedAt && Date.now() - previous.startedAt < RESUME_WITHIN_MS;
    const meta: SyncMeta = resumable
      ? { ...previous!, lastChange }
      : { key, runId: mintOperationId(), cursor: null, done: 0, total: null, startedAt: Date.now(), completedAt: null, lastChange };
    publish({ state: 'syncing', done: meta.done, total: meta.total, completedAt: null, error: null });

    for (;;) {
      // Stop quietly (progress is saved) if the connection went, or someone else signed in.
      if (!navigator.onLine || loadUserCache()?.id !== owner) {
        publish({ state: 'paused' });
        return;
      }
      const page = await withTimeout(apiClient.get<Bundle>(`/offline/bundle?limit=${PAGE_SIZE}${meta.cursor ? `&after=${meta.cursor}` : ''}`), PAGE_TIMEOUT_MS);
      const entries: OfflineRecord[] = [];
      for (const resource of RECORD_RESOURCES) {
        for (const data of page[resource] ?? []) {
          const entry = toOfflineRecord(owner, resource, data, meta.runId);
          if (entry) entries.push(entry);
        }
      }
      await putOfflineRecords(entries);
      meta.done += page.students.length;
      meta.total = page.total ?? meta.total;
      meta.cursor = page.next;
      await putOfflineMeta({ ...meta });
      publish({ state: 'syncing', done: meta.done, total: meta.total });
      if (!meta.cursor) break;
      await new Promise((resolve) => setTimeout(resolve, 30)); // background work: never hog the page
    }

    await deleteOfflineRecordsNotInRun(owner, meta.runId);
    await Promise.allSettled(SCREEN_LISTS.map((path) => apiClient.get(path)));
    meta.completedAt = Date.now();
    await putOfflineMeta({ ...meta });
    publish({ state: 'ready', done: meta.done, total: meta.total ?? meta.done, completedAt: meta.completedAt, error: null });
  } catch (err) {
    // Offline mid-run, or the server said no: progress is saved. Say WHY, so it is
    // not a silent half-download, and it resumes by itself when the connection returns.
    publish({ state: 'paused', error: reasonFor(err) });
  } finally {
    running = false;
  }
}

// Back online: pick the download up where it stopped (it does nothing if it is
// already complete and current, or nobody is signed in).
if (typeof window !== 'undefined') window.addEventListener('online', () => { void startBulkSync(); });
