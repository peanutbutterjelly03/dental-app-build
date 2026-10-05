const QUEUED_STUDENT_IDS_KEY = 'queued-student-ids';

// Real students have 24-hex Mongo ids; anything shorter is the removed demo
// seed ('1','3',…) still sitting in some browsers' localStorage — drop it.
const normalizeIds = (ids: string[]) => [...new Set(ids.map(String))].filter(id => id.length === 24);

export const getQueuedStudentIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(QUEUED_STUDENT_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid queued student payload');
    return normalizeIds(parsed);
  } catch {
    window.localStorage.removeItem(QUEUED_STUDENT_IDS_KEY);
    return [];
  }
};

export const setQueuedStudentIds = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUED_STUDENT_IDS_KEY, JSON.stringify(normalizeIds(ids)));
};

export const addQueuedStudentId = (id: string) => {
  const next = normalizeIds([...getQueuedStudentIds(), String(id)]);
  setQueuedStudentIds(next);
  return next;
};

export const removeQueuedStudentId = (id: string) => {
  const next = getQueuedStudentIds().filter(existingId => existingId !== String(id));
  setQueuedStudentIds(next);
  return next;
};

// The actual "Queue #" every queued student is given (user, 2026-09-27):
// appointments-today students bypass raw queue position entirely and get
// renumbered 1, 2, 3… ahead of everyone else, who then continue after them
// in their existing relative order. Shared here, not duplicated per screen
// (Dental Charts' own queue table AND the Dental Chart page's Prev/Next nav
// both need the exact same order, or "Next" from one screen can disagree
// with the number shown on the other).
export const getEffectiveQueueOrder = (queuedIds: string[], appointmentsTodayIds: Set<string>): string[] =>
  [...queuedIds].sort((a, b) => {
    const apptA = appointmentsTodayIds.has(a) ? 0 : 1;
    const apptB = appointmentsTodayIds.has(b) ? 0 : 1;
    if (apptA !== apptB) return apptA - apptB;
    return queuedIds.indexOf(a) - queuedIds.indexOf(b);
  });
