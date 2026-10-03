// Offline READS. The write queue (db.ts / queueProcessor.ts) lets staff save
// while offline; this is what lets them open a record to save against.
//
// The service worker caches every API read it sees, so any page already opened
// while online works offline. What it cannot do is cache a page nobody opened
// yet — and the field workflow is exactly "open the day's queued children at a
// school with no signal". So while online we pre-read the charts of the
// students in the Charting Queue and the Treatment Queue (a handful, picked by
// staff), through the same URLs useDentalChartData asks for, so the service
// worker has them before the connection goes.
//
// Deliberately NOT done: pre-reading the whole roster. /stats/student-rows
// decrypts every student on every request (see utils/apiCache.ts); doing that
// at startup for a list staff may never open is the wrong trade. The roster
// is cached the first time Student Records is opened online.
import { getQueuedStudentIds } from '../utils/queueStorage';
import { getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';

const API_CACHES = ['api-cache', 'stats-cache'];
const WARM_STAMP_KEY = 'floral_offline_warm_at';
const WARM_EVERY_MS = 10 * 60 * 1000;
const MAX_STUDENTS = 25;

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  return res.ok ? res.json() : null;
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

/** Sign-out on a shared clinic PC: the cached reads hold decrypted student
 *  records, so they go with the session. Unsynced WRITES are untouched — they
 *  stay queued under their owner (SEC-27) and sync when that person signs in. */
export async function clearOfflineReadCaches(): Promise<void> {
  try {
    if (!('caches' in globalThis)) return;
    await Promise.all(API_CACHES.map((name) => caches.delete(name)));
    localStorage.removeItem(WARM_STAMP_KEY);
  } catch {
    // Cache API unavailable — nothing was cached to clear.
  }
}
