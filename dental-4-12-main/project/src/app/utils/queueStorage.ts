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
