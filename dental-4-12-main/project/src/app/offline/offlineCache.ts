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

/** Goes through apiClient.get on purpose: that is what saves the response. */
async function readJson(path: string): Promise<unknown> {
  try {
    return await apiClient.get(path);
  } catch {
    return null;
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

/** Pre-reads every queued student not yet read this session, one at a time
 *  (background work must not compete with what the person is doing). */
async function warmQueuedStudents(): Promise<void> {
  for (const id of queuedIds()) {
    if (!navigator.onLine) return;
    if (warmedThisSession.has(id)) continue;
    warmedThisSession.add(id);
    await warmStudentChart(id).catch(() => warmedThisSession.delete(id));
  }
}

/** Best-effort, never throws, never blocks. Skips when offline, and the school
 *  lists when it ran within the last few minutes. */
export async function warmOfflineCache(): Promise<void> {
  try {
    if (!navigator.onLine) return;
    const last = Number(localStorage.getItem(WARM_STAMP_KEY) ?? 0);
    if (Date.now() - last >= WARM_EVERY_MS) {
      localStorage.setItem(WARM_STAMP_KEY, String(Date.now()));
      await Promise.all([readJson('/schools'), readJson('/dentists')]);
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
