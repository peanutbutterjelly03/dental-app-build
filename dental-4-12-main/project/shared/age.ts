/** Age helpers, shared so the brackets cannot drift apart.
 *
 *  ⚠ MOVED TO `shared/` IN SPRINT 145: the Risk list's age-group FILTER now
 *  runs on the server, and a server copy of these boundaries is exactly the
 *  divergence the note below warns about.
 *
 *  Sprint 106 lifted these out of `PatientList`, where they were defined inside
 *  the component. Risk Classification needed the same age-group filter, and a
 *  second copy is how two screens end up disagreeing about which bracket a
 *  9-year-old is in — the DOH reports are built on these boundaries, so a
 *  divergence would be a reporting error, not a cosmetic one. */

/** Whole years as of today, or null when the birthdate is missing/unparseable. */
export function calculateAge(birthdate: string): number | null {
  const today = new Date();
  const birth = new Date(birthdate);
  if (isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** The DOH age brackets used across the student lists and reports. */
export function getAgeGroup(age: number | null): string {
  if (age === null) return 'Unknown';
  if (age <= 4) return '4 & below';
  if (age <= 9) return '5-9';
  if (age <= 14) return '10-14';
  if (age <= 19) return '15-19';
  return '20 & above';
}

/** The bracket labels in order, for building a filter dropdown. */
export const AGE_GROUPS = ['4 & below', '5-9', '10-14', '15-19', '20 & above'] as const;
