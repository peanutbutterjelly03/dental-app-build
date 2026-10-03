// Warming and clearing the per-user read cache (readCache.ts).
//
// The cache fills as pages are opened online. What it cannot hold is a page
// nobody opened yet — and the field workflow is exactly "open the day's queued
// children at a school with no signal". So while online we read the charts of the
// students in the Charting Queue and the Treatment Queue (a handful, picked by
// staff) through the same requests the chart page makes, which saves them.
//
// Deliberately NOT done: pre-reading the whole roster. /stats/student-rows
// decrypts every student on every request (see utils/apiCache.ts); doing that at
// startup for a list staff may never open is the wrong trade. The roster is saved
// the first time Student Records is opened online.
import { apiClient } from '../api/client';
import { clearReadCache } from './db';
import { getQueuedStudentIds } from '../utils/queueStorage';
import { getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';

// Cache Storage copies left by earlier service workers (they cached API reads).
const LEGACY_CACHES = ['api-cache', 'stats-cache'];
const WARM_STAMP_KEY = 'floral_offline_warm_at';
const WARM_EVERY_MS = 10 * 60 * 1000;
const MAX_STUDENTS = 25;

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

/** Best-effort, never throws, never blocks. Skips when offline, and when it ran
 *  within the last few minutes (every page load would otherwise repeat it). */
export async function warmOfflineCache(): Promise<void> {
  try {
    if (!navigator.onLine) return;
    const last = Number(localStorage.getItem(WARM_STAMP_KEY) ?? 0);
    if (Date.now() - last < WARM_EVERY_MS) return;
    localStorage.setItem(WARM_STAMP_KEY, String(Date.now()));

    const ids = [...new Set([...getQueuedStudentIds(), ...getTreatmentQueueStudentIds()])].slice(0, MAX_STUDENTS);
    await Promise.all([readJson('/schools'), readJson('/dentists')]);
    // One student at a time: this is background work and must not compete with
    // whatever the person is actually doing.
    for (const id of ids) {
      if (!navigator.onLine) return;
      await warmStudentChart(id).catch(() => {});
    }
  } catch {
    // Warming is an optimisation. Failing to do it changes nothing.
  }
}

/** Sign-out on a shared clinic PC: the saved reads hold decrypted student
 *  records, so they go with the session. Unsynced WRITES are untouched — they
 *  stay queued under their owner (SEC-27) and sync when that person signs in. */
export async function clearOfflineReadCaches(): Promise<void> {
  try {
    await clearReadCache();
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
