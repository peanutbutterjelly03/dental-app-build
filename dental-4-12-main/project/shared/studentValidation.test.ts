// CHARACTERIZATION tests — Sprint 158.
//
// These lock in what the code does TODAY. They are not a specification, and a
// failure does not automatically mean the test is wrong: it means behaviour
// changed, and someone has to decide which side was right.
//
// Why this file first: `validateStudentValues` is the gate `crudFactory` calls
// on every Student write, and the module's own header explains that it is the
// ONLY check the offline queue passes through — the queue replays POSTs
// straight to the API and goes through no form at all. If these rules drift,
// bad rows enter from the one path nobody is watching.
//
// ⚠ Anything here that looks wrong becomes a BUG-nn row in
// docs/audit/LEDGER-bug.md, never an edit in this file's sprint.

import { describe, it, expect } from 'vitest';
import {
  ageOn,
  validateBirthdate,
  validateName,
  validatePhone,
  validateStudentValues,
  MAX_NAME_LENGTH,
  MIN_AGE_YEARS,
  MAX_AGE_YEARS,
} from './studentValidation';

describe('ageOn', () => {
  it('counts whole years, not calendar-year differences', () => {
    // Born 2015-06-15, measured 2026-06-14 — one day short of the 11th birthday.
    expect(ageOn('2015-06-15', new Date('2026-06-14'))).toBe(10);
    expect(ageOn('2015-06-15', new Date('2026-06-15'))).toBe(11);
  });

  it('handles a birthday earlier in the same month', () => {
    expect(ageOn('2015-06-01', new Date('2026-06-15'))).toBe(11);
  });

  it('accepts a Date as well as a yyyy-mm-dd string', () => {
    expect(ageOn(new Date('2015-06-15'), new Date('2026-07-01'))).toBe(11);
  });
});

describe('validateBirthdate', () => {
  it('passes an empty value — presence is a separate check', () => {
    expect(validateBirthdate('')).toBeNull();
    expect(validateBirthdate('   ')).toBeNull();
  });

  it('rejects a date that is not real', () => {
    expect(validateBirthdate('not-a-date')).toMatch(/is not a real date/);
  });

  it('rejects a future birthdate', () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    expect(validateBirthdate(nextYear.toISOString().slice(0, 10))).toBe(
      'Birthdate cannot be in the future.',
    );
  });

  it('rejects an age outside the school-age range at both ends', () => {
    const tooYoung = new Date();
    tooYoung.setFullYear(tooYoung.getFullYear() - (MIN_AGE_YEARS - 1));
    expect(validateBirthdate(tooYoung.toISOString().slice(0, 10))).toMatch(/check the year/);

    const tooOld = new Date();
    tooOld.setFullYear(tooOld.getFullYear() - (MAX_AGE_YEARS + 1));
    expect(validateBirthdate(tooOld.toISOString().slice(0, 10))).toMatch(/check the year/);
  });

  it('accepts an age at both boundaries — the range is inclusive', () => {
    const atMin = new Date();
    atMin.setFullYear(atMin.getFullYear() - MIN_AGE_YEARS);
    expect(validateBirthdate(atMin.toISOString().slice(0, 10))).toBeNull();

    const atMax = new Date();
    atMax.setFullYear(atMax.getFullYear() - MAX_AGE_YEARS);
    expect(validateBirthdate(atMax.toISOString().slice(0, 10))).toBeNull();
  });
});

describe('validateName', () => {
  it('passes an empty value — presence is a separate check', () => {
    expect(validateName('', 'Last Name')).toBeNull();
  });

  it('ALLOWS ALL CAPS, deliberately — the DOH paper forms are filled in caps', () => {
    expect(validateName('DELA CRUZ', 'Last Name')).toBeNull();
  });

  it('accepts the punctuation that really occurs in Filipino names', () => {
    expect(validateName("O'Brien", 'Last Name')).toBeNull();
    expect(validateName('Dela Cruz-Santos', 'Last Name')).toBeNull();
    expect(validateName('Jr.', 'Last Name')).toBeNull();
    expect(validateName('Muñoz', 'Last Name')).toBeNull(); // n-tilde
    expect(validateName('José', 'First Name')).toBeNull(); // accent
  });

  it('rejects digits and symbols', () => {
    expect(validateName('Juan2', 'First Name')).toMatch(/not part of a name/);
    expect(validateName('Juan@', 'First Name')).toMatch(/not part of a name/);
  });

  it('measures length AFTER trimming', () => {
    expect(validateName('a'.repeat(MAX_NAME_LENGTH), 'Last Name')).toBeNull();
    expect(validateName('a'.repeat(MAX_NAME_LENGTH + 1), 'Last Name')).toMatch(/longer than/);
    expect(validateName(`  ${'a'.repeat(MAX_NAME_LENGTH)}  `, 'Last Name')).toBeNull();
  });

  it('names the field in the message, so an encoder knows which box is wrong', () => {
    expect(validateName('Juan2', 'Middle Name')).toMatch(/^Middle Name/);
  });
});

describe('validatePhone', () => {
  it('passes an empty value — presence is a separate check', () => {
    expect(validatePhone('', 'Contact Number')).toBeNull();
  });

  it('accepts an 11-digit mobile', () => {
    expect(validatePhone('09171234567', 'Contact Number')).toBeNull();
  });

  it('accepts the +63 and bare-63 international forms', () => {
    expect(validatePhone('+639171234567', 'Contact Number')).toBeNull();
    expect(validatePhone('639171234567', 'Contact Number')).toBeNull();
  });

  it('accepts the punctuation an encoder copies off the form', () => {
    expect(validatePhone('0917 123 4567', 'Contact Number')).toBeNull();
    expect(validatePhone('(02) 8123-4567', 'Contact Number')).toBeNull();
  });

  it('accepts NCR and provincial landlines', () => {
    expect(validatePhone('0281234567', 'Contact Number')).toBeNull(); // NCR, 10 digits
    expect(validatePhone('0321234567', 'Contact Number')).toBeNull(); // provincial
  });

  it('rejects a mobile of the wrong length', () => {
    expect(validatePhone('0917123456', 'Contact Number')).toMatch(/not a valid PH/);
    expect(validatePhone('091712345678', 'Contact Number')).toMatch(/not a valid PH/);
  });

  it('rejects letters with a message about punctuation, not about format', () => {
    expect(validatePhone('0917-CALL-ME', 'Contact Number')).toMatch(/only digits and phone punctuation/);
  });
});

describe('validateStudentValues', () => {
  it('returns an empty array when everything is fine', () => {
    expect(
      validateStudentValues({
        lastName: 'Dela Cruz',
        firstName: 'Juan',
        birthdate: '2015-06-15',
        contactNumber: '09171234567',
      }),
    ).toEqual([]);
  });

  it('treats every field as optional — a PUT body is partial', () => {
    // The route validates the PARTIAL update, so absent fields must not fail.
    expect(validateStudentValues({})).toEqual([]);
    expect(validateStudentValues({ firstName: 'Juan' })).toEqual([]);
  });

  it('reports EVERY problem at once, so the encoder fixes them in one pass', () => {
    const problems = validateStudentValues({
      lastName: 'Dela Cruz2',
      firstName: 'Juan@',
      birthdate: 'nonsense',
      contactNumber: '123',
    });
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/Last Name/);
    expect(problems.join(' ')).toMatch(/First Name/);
    expect(problems.join(' ')).toMatch(/real date/);
    expect(problems.join(' ')).toMatch(/Contact Number/);
  });

  it('checks guardian_contact by the same rule as contact_number', () => {
    expect(validateStudentValues({ guardianContact: '09171234567' })).toEqual([]);
    expect(validateStudentValues({ guardianContact: '123' })).toHaveLength(1);
  });
});
