// Warming and clearing what this device holds for offline use.
//
// Offline data is the students staff queued in Dental Charts or Treatment, plus
// any student already opened on this device (readCache.ts saves every read). A
// student is pre-read the moment they are queued, and again on sign-in, so the
// day's children are ready before the connection goes. Nobody else is downloaded.
import { apiClient } from '../api/client';
import { clearReadCache, clearOfflineRecords } from './db';
import { getQueuedStudentIds, QUEUE_CHANGED_EVENT } from '../utils/queueStorage';
import { getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';

// Cache Storage copies left by earlier service workers (they cached API reads).
const LEGACY_CACHES = ['api-cache', 'stats-cache'];
const WARM_STAMP_KEY = 'floral_offline_warm_at';
const WARM_EVERY_MS = 10 * 60 * 1000;

class WarmFailed extends Error {}

/** Goes through apiClient.get on purpose: that is what saves the response.
 *  A failed read throws, so a half-read student is never counted as ready. */
async function readJson(path: string): Promise<unknown> {
  try {
    return await apiClient.get(path);
  } catch {
    throw new WarmFailed(path);
  }
}

/** The same requests, in the same shape, as hooks/useDentalChartData.ts. If
 *  that hook's URLs change, change them here — a mismatch only costs a cache
 *  miss offline, never a wrong answer. */
async function warmStudentChart(studentId: string): Promise<void> {
  const [, iptrs] = await Promise.all([readJson(`/students/${studentId}`), readJson(`/student-iptrs?student_id=${studentId}`)]);
  const iptrList = Array.isArray(iptrs) ? (iptrs as { _id: string }[]) : [];
  if (iptrList.length === 0) return;
  const q = iptrList.map((i) => i._id).join(',');
  const [, , , charts] = await Promise.all([
    readJson(`/medical-histories?iptr_id=${q}`),
    readJson(`/dietary-social-habits?iptr_id=${q}`),
    readJson(`/oral-health-conditions?iptr_id=${q}`),
    readJson(`/dental-charts?iptr_id=${q}`),
    readJson(`/treatments?iptr_id=${q}`),
    readJson(`/referrals?iptr_id=${q}`),
    readJson(`/preventive-care-records?iptr_id=${q}`),
  ]);
  const chartIds = Array.isArray(charts) ? (charts as { _id: string }[]).map((c) => c._id) : [];
  if (chartIds.length) await readJson(`/tooth-records?chart_id=${chartIds.join(',')}`);
}

const queuedIds = () => [...new Set([...getQueuedStudentIds(), ...getTreatmentQueueStudentIds()])];
const warmedThisSession = new Set<string>();
const inFlight = new Set<string>();
const WARM_PARALLEL = 3;

/** How many of the queued students are saved on this device, for the screens. */
export interface OfflineReadiness {
  ready: number;
  total: number;
  /** A read is in progress right now. */
  busy: boolean;
}
let readiness: OfflineReadiness = { ready: 0, total: 0, busy: false };
const listeners = new Set<() => void>();
export const getOfflineReadiness = () => readiness;
export function subscribeOfflineReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function refreshReadiness() {
  const ids = queuedIds();
  const next = { ready: ids.filter((id) => warmedThisSession.has(id)).length, total: ids.length, busy: inFlight.size > 0 };
  if (next.ready === readiness.ready && next.total === readiness.total && next.busy === readiness.busy) return;
  readiness = next;
  for (const listener of listeners) listener();
}

/** Pre-reads every queued student not yet fully read this session, a few at a
 *  time (one at a time left the last students of a long queue unread when the
 *  connection went). A student counts as ready only when EVERY read succeeded;
 *  one that failed is tried again on the next queue change or reconnect. */
async function warmQueuedStudents(): Promise<void> {
  const todo = queuedIds().filter((id) => !warmedThisSession.has(id) && !inFlight.has(id));
  refreshReadiness();
  const worker = async () => {
    for (let id = todo.shift(); id; id = todo.shift()) {
      if (!navigator.onLine) return;
      inFlight.add(id);
      refreshReadiness();
      try {
        await warmStudentChart(id);
        warmedThisSession.add(id);
      } catch {
        /* left unmarked: retried later */
      } finally {
        inFlight.delete(id);
        refreshReadiness();
      }
    }
  };
  await Promise.all(Array.from({ length: WARM_PARALLEL }, worker));
  refreshReadiness();
}

/** For the "Try again" button when some queued students did not get saved. */
export const retryOfflineWarm = () => warmQueuedStudents().catch(() => {});

/** Best-effort, never throws, never blocks. Skips when offline, and the school
 *  lists when it ran within the last few minutes. */
export async function warmOfflineCache(): Promise<void> {
  try {
    if (!navigator.onLine) return;
    const last = Number(localStorage.getItem(WARM_STAMP_KEY) ?? 0);
    if (Date.now() - last >= WARM_EVERY_MS) {
      localStorage.setItem(WARM_STAMP_KEY, String(Date.now()));
      await Promise.allSettled([readJson('/schools'), readJson('/dentists')]);
      warmedThisSession.clear(); // a fresh read picks up changes made elsewhere
    }
    await warmQueuedStudents();
  } catch {
    // Warming is an optimisation. Failing to do it changes nothing.
  }
}

// A student added to either queue is read straight away. Only while signed in
// (warming needs the session); signed-out reads would just fail quietly.
if (typeof window !== 'undefined') {
  window.addEventListener(QUEUE_CHANGED_EVENT, () => { void warmQueuedStudents().catch(() => {}); });
  window.addEventListener('online', () => { void warmQueuedStudents().catch(() => {}); });
}

/** Sign-out on a shared clinic PC: the saved reads hold decrypted student
 *  records, so they go with the session. Unsynced WRITES are untouched — they
 *  stay queued under their owner (SEC-27) and sync when that person signs in. */
export async function clearOfflineReadCaches(): Promise<void> {
  try {
    await clearReadCache();
    await clearOfflineRecords();
    warmedThisSession.clear();
    refreshReadiness();
    localStorage.removeItem(WARM_STAMP_KEY);
  } catch {
    // Nothing was saved to clear.
  }
  try {
    if ('caches' in globalThis) await Promise.all(LEGACY_CACHES.map((name) => caches.delete(name)));
  } catch {
    // Cache API unavailable.
  }
}
