// Value-level validation for student fields -- ONE source for BOTH SIDES.
//
// Lives in shared/ (included by tsconfig.json and tsconfig.server.json) so the
// client forms and the API enforce the SAME rules from the SAME file. The
// alternative -- a copy under server/ -- re-creates exactly the drift this
// module exists to prevent; demoStudents.ts is the standing example of how
// that goes.
//
// Client callers: the Add Student form, the CSV/XLSX bulk import, and the
// student-info edit on the chart (OCR feeds the same form, so it inherits
// these checks for free). Server caller: the Student CRUD router's
// validateBody, which is the only gate the OFFLINE QUEUE passes through -- it
// replays POSTs straight to the API, bypassing every form.
//
// Sprint 62 made the REQUIRED fields impossible to drift by deriving both the
// asterisks and the check from one list. This is the same idea for VALUES:
// duplicating "what counts as a valid birthday" across the form and the
// importer is how demoStudents.ts drifted, and the importer is the path that
// can insert hundreds of bad rows with nobody looking.
//
// Enforced at ENTRY only, never on the model. All existing records predate
// these rules, and CRUD updates go through findById + save() -- a schema-level
// rule would make every existing record unsaveable on its next edit (the same
// reasoning that kept REQUIRED_STUDENT_FIELDS out of the Student model).

/** docs/DATA-MODEL.md specifies VARCHAR 60 per name part. Match the doc rather
 *  than inventing a number. */
export const MAX_NAME_LENGTH = 60;

/** K-Grade 10 with retained pupils. Deliberately generous at the top: the point
 *  is to catch a mistyped YEAR (2020 -> 2002), not to police enrolment. */
export const MIN_AGE_YEARS = 3;
export const MAX_AGE_YEARS = 25;

/** Age in whole years on `on`, from a yyyy-mm-dd string or Date. */
export function ageOn(birth: string | Date, on: Date = new Date()): number {
  const b = typeof birth === 'string' ? new Date(birth) : birth;
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

/**
 * A birthday must be a real date, not in the future, and inside a plausible
 * school-age range.
 *
 * WARNING: this is a REPORTING-CORRECTNESS check, not form polish. Age is
 * derived at examination date (Sprint 57b), so a mistyped birthday silently
 * shifts a pupil into the wrong DOH age bracket and the report still looks
 * authoritative.
 */
export function validateBirthdate(value: string): string | null {
  if (!value.trim()) return null; // presence is handled by the required check
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return `Birthdate "${value}" is not a real date.`;
  const today = new Date();
  if (d.getTime() > today.getTime()) return 'Birthdate cannot be in the future.';
  const age = ageOn(d, today);
  if (age > MAX_AGE_YEARS) return `Birthdate gives an age of ${age} - check the year.`;
  if (age < MIN_AGE_YEARS) return `Birthdate gives an age of ${age} - check the year.`;
  return null;
}

// Letters (including n-tilde and accents), spaces, hyphen, apostrophe, period.
// ALL CAPS IS ALLOWED, DELIBERATELY. The DOH paper forms are filled in caps,
// OCR reads caps, and the encoder is copying a form -- the record should match
// the paper on audit. Never rewrite what the encoder typed; if a consistent
// look is wanted, normalise for DISPLAY instead.
const NAME_OK = /^[\p{L}\p{M}\s.'-]+$/u;

export function validateName(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return null; // presence handled by the required check
  if (v.length > MAX_NAME_LENGTH) return `${label} is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!NAME_OK.test(v)) return `${label} contains characters that are not part of a name.`;
  return null;
}

/**
 * Philippine numbers, by structure rather than by a carrier list.
 *
 * Accepted: mobile `09XXXXXXXXX` (11 digits) and `+639XXXXXXXXX`; landline as
 * 9-10 digits including the area code, which covers NCR `(02) XXXX-XXXX` and
 * the 3-digit provincial codes. Punctuation, spaces and a leading +63 are
 * stripped before checking, so the encoder can type it the way the form shows.
 *
 * WARNING: contact_number and guardian_contact are ENCRYPTED (Sprint 26 random
 * IV), so this can only ever run client-side or in the route BEFORE encryption
 * -- a DB constraint or a regex query on the stored value is impossible.
 */
export function validatePhone(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return null; // presence handled by the required check
  if (/[^\d\s()+\-.]/.test(v)) return `${label} should contain only digits and phone punctuation.`;
  let digits = v.replace(/[^\d+]/g, '');
  if (digits.startsWith('+63')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('63') && digits.length === 12) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return null; // mobile, 11 digits
  if (/^0[2-8]\d{7,8}$/.test(digits)) return null; // landline incl. area code
  return `${label} is not a valid PH mobile (09XX XXX XXXX) or landline number.`;
}

export interface StudentValues {
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthdate?: string;
  contactNumber?: string;
  guardianContact?: string;
}

/** Every value problem at once, so the encoder fixes them in one pass instead
 *  of one per save. An empty array means nothing is wrong. */
export function validateStudentValues(v: StudentValues): string[] {
  return [
    validateName(v.lastName ?? '', 'Last Name'),
    validateName(v.firstName ?? '', 'First Name'),
    validateName(v.middleName ?? '', 'Middle Name'),
    validateBirthdate(v.birthdate ?? ''),
    validatePhone(v.contactNumber ?? '', 'Contact Number'),
    validatePhone(v.guardianContact ?? '', 'Guardian Contact'),
  ].filter((m): m is string => m !== null);
}
