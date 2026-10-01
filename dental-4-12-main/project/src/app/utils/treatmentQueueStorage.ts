// The Treatment submodule's own queue -- same localStorage pattern as
// queueStorage.ts (the Dental Charts "Charting Queue"), deliberately kept
// separate: a student leaves the charting queue the moment their chart is
// saved (removeQueuedStudentId, see DentalChart.tsx's handleSave), but
// enters THIS queue at that exact moment, because that save is what first
// puts real dental work in front of a dentist to review and administer.
//
// Added automatically (user, 2026-09-28): any dental chart save that leaves
// behind a charted tooth condition/treatment or a ticked oral health
// condition queues that pupil here, whether or not this particular save is
// what changed it -- a chart that already has decay marked on it queues its
// pupil again on every subsequent save, not just the first one that charted
// it. Removed AUTOMATICALLY too (user, 2026-09-28, "remove mark as done, it
// should be automatic") -- TreatmentRecords.tsx drops a pupil from this list
// the moment they appear in the real per-year treatment aggregation
// (/stats/treatment-categories), no manual action. The one manual override
// left is "Clear queue" (setTreatmentQueueStudentIds([])), for a pupil
// queued in error.

const TREATMENT_QUEUE_STUDENT_IDS_KEY = 'treatment-queue-student-ids';

// Real students have 24-hex Mongo ids; anything shorter is stale/demo data.
const normalizeIds = (ids: string[]) => [...new Set(ids.map(String))].filter(id => id.length === 24);

export const getTreatmentQueueStudentIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(TREATMENT_QUEUE_STUDENT_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid treatment queue payload');
    return normalizeIds(parsed);
  } catch {
    window.localStorage.removeItem(TREATMENT_QUEUE_STUDENT_IDS_KEY);
    return [];
  }
};

export const setTreatmentQueueStudentIds = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TREATMENT_QUEUE_STUDENT_IDS_KEY, JSON.stringify(normalizeIds(ids)));
};

export const addTreatmentQueueStudentId = (id: string) => {
  const next = normalizeIds([...getTreatmentQueueStudentIds(), String(id)]);
  setTreatmentQueueStudentIds(next);
  return next;
};
