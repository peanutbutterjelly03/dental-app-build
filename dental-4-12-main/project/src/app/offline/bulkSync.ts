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
import { apiClient } from '../api/client';
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
}

let status: OfflineDataStatus = { state: 'idle', done: 0, total: null, completedAt: null };
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
  publish({ state: 'idle', done: 0, total: null, completedAt: null });
}

const metaKey = (owner: string) => `${owner}|sync`;

/** What a freshly loaded page should say before (or without) a run of its own. */
export async function loadOfflineDataStatus(): Promise<void> {
  const owner = loadUserCache()?.id;
  if (!owner || status.state === 'syncing') return;
  try {
    const meta = await getOfflineMeta<SyncMeta>(metaKey(owner));
    if (!meta) publish({ state: 'idle', done: 0, total: null, completedAt: null });
    else if (meta.completedAt) publish({ state: 'ready', done: meta.done, total: meta.total ?? meta.done, completedAt: meta.completedAt });
    else publish({ state: 'paused', done: meta.done, total: meta.total, completedAt: null });
  } catch {
    /* storage unavailable: leave the status as it is */
  }
}

let running = false;

export async function startBulkSync(): Promise<void> {
  const user = loadUserCache();
  if (running || !navigator.onLine || !user || !CLINICAL_READERS.includes(user.role)) return;
  running = true;
  const owner = user.id;
  const key = metaKey(owner);
  try {
    const previous = await getOfflineMeta<SyncMeta>(key);
    // When anything that is downloaded last changed (NOT /stats/last-change: every sign-in moves that).
    const lastChange = await apiClient.get<{ at: string | null }>('/offline/version').then((r) => r.at, () => null);

    // Nothing that is downloaded has changed since the last complete run: already current.
    // (A null answer means there is no change history to compare, so download.)
    if (previous?.completedAt && lastChange !== null && previous.lastChange === lastChange) {
      publish({ state: 'ready', done: previous.done, total: previous.total ?? previous.done, completedAt: previous.completedAt });
      return;
    }

    const resumable = !!previous && !previous.completedAt && Date.now() - previous.startedAt < RESUME_WITHIN_MS;
    const meta: SyncMeta = resumable
      ? { ...previous!, lastChange }
      : { key, runId: mintOperationId(), cursor: null, done: 0, total: null, startedAt: Date.now(), completedAt: null, lastChange };
    publish({ state: 'syncing', done: meta.done, total: meta.total, completedAt: null });

    for (;;) {
      // Stop quietly (progress is saved) if the connection went, or someone else signed in.
      if (!navigator.onLine || loadUserCache()?.id !== owner) {
        publish({ state: 'paused' });
        return;
      }
      const page = await apiClient.get<Bundle>(`/offline/bundle?limit=${PAGE_SIZE}${meta.cursor ? `&after=${meta.cursor}` : ''}`);
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
    publish({ state: 'ready', done: meta.done, total: meta.total ?? meta.done, completedAt: meta.completedAt });
  } catch {
    // Offline mid-run, or the server said no: progress is saved, the next sign-in resumes.
    publish({ state: 'paused' });
  } finally {
    running = false;
  }
}
