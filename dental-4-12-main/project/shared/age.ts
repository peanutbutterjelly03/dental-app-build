/** Age helpers — THE ONLY age arithmetic and bracket boundaries in the app.
 *
 *  ⚠ MOVED TO `shared/` IN SPRINT 145: the Risk list's age-group FILTER now
 *  runs on the server, and a server copy of these boundaries is exactly the
 *  divergence the note below warns about.
 *
 *  Sprint 106 lifted these out of `PatientList`, where they were defined inside
 *  the component. Risk Classification needed the same age-group filter, and a
 *  second copy is how two screens end up disagreeing about which bracket a
 *  9-year-old is in — the DOH reports are built on these boundaries, so a
 *  divergence would be a reporting error, not a cosmetic one.
 *
 *  ⚠ BUG-02 (2026-09-29): there were EIGHT age calculations and SIX bracket
 *  functions by then, disagreeing on a bad birthdate (null / NaN / 0), and the
 *  Barangay Health Office dashboard's was plainly wrong (year minus year, and
 *  non-DOH brackets with no 20+ row). Every one now calls these. Do not add a
 *  local copy "for convenience" — import from here. */

/** Whole years completed on `on` (default: now), or null when the birthdate is
 *  missing or unparseable — never NaN, never 0.
 *
 *  The month/day comparison is not a nicety: `yearA - yearB` alone reports a
 *  child born in December 2015 as 11 during 2026 when they are still 10, so
 *  roughly a twelfth of pupils land one age bracket too high. */
export function ageOn(birth: string | Date | null | undefined, on: Date = new Date()): number | null {
  if (birth === null || birth === undefined || birth === '') return null;
  const b = typeof birth === 'string' ? new Date(birth) : birth;
  if (Number.isNaN(b.getTime())) return null;
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

/** Whole years as of today, or null when the birthdate is missing/unparseable. */
export function calculateAge(birthdate: string | null | undefined): number | null {
  return ageOn(birthdate);
}

/** Upper bound (inclusive) of each DOH bracket; the last is open-ended. The ONE
 *  boundary table — both label sets below index into it. */
const BRACKET_MAX = [4, 9, 14, 19] as const;

/** Which DOH bracket an age falls in, 0-4, or null when the age is unknown. */
export function ageBracketIndex(age: number | null): number | null {
  if (age === null || Number.isNaN(age)) return null;
  const i = BRACKET_MAX.findIndex((max) => age <= max);
  return i === -1 ? BRACKET_MAX.length : i;
}

/** The bracket labels in order, as SCREENS show them (filters, dashboards). */
export const AGE_GROUPS = ['4 & below', '5-9', '10-14', '15-19', '20 & above'] as const;

/** The same brackets as the DOH FORMS print them. ⚠ These strings key the DOH
 *  report tallies — change them only together with the form. */
export const DOH_AGE_BRACKETS = ['4 yrs & below', '5-9 yrs', '10-14 yrs', '15-19 yrs', '20 yrs & above'] as const;

/** The DOH age brackets used across the student lists and reports. */
export function getAgeGroup(age: number | null): string {
  const i = ageBracketIndex(age);
  return i === null ? 'Unknown' : AGE_GROUPS[i];
}
