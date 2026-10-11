// The clinic's year is the DepEd school calendar, June through April, not the
// calendar year — per the dentist, "kailangan pumasok siya sa school calendar".
// May falls outside the calendar entirely and is bucketed to the school year
// that is about to start, so every date belongs to exactly one school year.
//
// ⚠ MOVED HERE FROM `src/app/utils` IN SPRINT 140. The RPC window and the
// appointments window already shared this on the client; the SERVER now needs
// it too (the RPC roll-up moved server-side), and `server/scripts/
// migrateIptrGrades.ts` keeps its own copy because server code could not
// import from `src/`. `shared/` removes that excuse — one school-year rule for
// every consumer, which is the whole point of the file.

/** Start of the school year containing `d` — June 1. */
export function schoolYearStart(d: Date): Date {
  const m = d.getMonth(); // 0-indexed
  return m <= 3 ? new Date(d.getFullYear() - 1, 5, 1) : new Date(d.getFullYear(), 5, 1);
}

/** End of the school year containing `d` — April 30. June–Dec → April 30 next
 *  year; Jan–Apr → April 30 same year; May → bucketed to the next school year. */
export function schoolYearEnd(d: Date): Date {
  const m = d.getMonth(); // 0-indexed
  return m <= 3 ? new Date(d.getFullYear(), 3, 30) : new Date(d.getFullYear() + 1, 3, 30);
}

/** The school year containing `d` as STUDENT_IPTR stores it, "YYYY-YYYY".
 *  Same bucketing as the two above, so a date cannot land in one school year by
 *  one function and a different one by another. `migrateIptrGrades.ts` keeps
 *  its own copy — server scripts do not import from `src/`. */
export function schoolYearLabel(d: Date = new Date()): string {
  const y = d.getFullYear();
  return d.getMonth() <= 3 ? `${y - 1}-${y}` : `${y}-${y + 1}`;
}

/** "2026-2027" -> "2027-2028". Hers, and it belongs here rather than in the
 *  component: UpdateSchoolYear and PromoteAssign both do this arithmetic, and
 *  two copies of it drift. */
export function nextSchoolYear(sy: string): string {
  const [a, b] = sy.split('-').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? `${a + 1}-${b + 1}` : sy;
}
