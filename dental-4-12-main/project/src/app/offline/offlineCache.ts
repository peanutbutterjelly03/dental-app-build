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

/** The same requests, in the same shape, as hooks/useDentalChartData.ts. The
 *  cache is keyed by the EXACT url, so the order of ids matters: that hook sorts
 *  the IPTRs oldest school year first and keeps only the charts of those IPTRs.
 *  If it changes, change this too; a mismatch is a cache miss offline for every
 *  student with more than one IPTR year. */
async function warmStudentChart(studentId: string): Promise<void> {
  const [, iptrs] = await Promise.all([readJson(`/students/${studentId}`), readJson(`/student-iptrs?student_id=${studentId}`)]);
  const iptrList = (Array.isArray(iptrs) ? (iptrs as { _id: string; school_year: string }[]) : [])
    .slice()
    .sort((a, b) => a.school_year.localeCompare(b.school_year));
  if (iptrList.length === 0) return;
  const ids = new Set(iptrList.map((i) => i._id));
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
  const chartIds = (Array.isArray(charts) ? (charts as { _id: string; iptr_id: string }[]) : []).filter((c) => ids.has(c.iptr_id)).map((c) => c._id);
  if (chartIds.length) await readJson(`/tooth-records?chart_id=${chartIds.join(',')}`);
}

const queuedIds = () => [...new Set([...getQueuedStudentIds(), ...getTreatmentQueueStudentIds()])];
const warmedThisSession = new Set<string>();
const inFlight = new Set<string>();
const WARM_PARALLEL = 3;

// Students whose chart is fully saved on this device, for the green queue number.
// Persisted (ids only, no patient data) so it is still right after an offline
// reload, and dropped at sign-out together with the cache itself.
const READY_KEY = 'floral_offline_ready_ids';
const loadReady = (): Set<string> => {
  try {
    const raw = JSON.parse(localStorage.getItem(READY_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
};
let readyIds: ReadonlySet<string> = typeof localStorage === 'undefined' ? new Set() : loadReady();
const listeners = new Set<() => void>();
export const getOfflineReadyIds = () => readyIds;
export function subscribeOfflineReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setReady(next: Set<string>) {
  readyIds = next;
  try { localStorage.setItem(READY_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
  for (const listener of listeners) listener();
}

/** Pre-reads every queued student not yet fully read this session, a few at a
 *  time (one at a time left the last students of a long queue unread when the
 *  connection went). A student counts as ready only when EVERY read succeeded;
 *  one that failed is tried again on the next queue change or reconnect. */
async function warmQueuedStudents(): Promise<void> {
  const todo = queuedIds().filter((id) => !warmedThisSession.has(id) && !inFlight.has(id));
  const worker = async () => {
    for (let id = todo.shift(); id; id = todo.shift()) {
      if (!navigator.onLine) return;
      inFlight.add(id);
      try {
        await warmStudentChart(id);
        warmedThisSession.add(id);
        if (!readyIds.has(id)) setReady(new Set([...readyIds, id]));
      } catch {
        /* left unmarked: retried later */
      } finally {
        inFlight.delete(id);
      }
    }
  };
  await Promise.all(Array.from({ length: WARM_PARALLEL }, worker));
}

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
    setReady(new Set());
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
