// CHARACTERIZATION tests — Sprint 158.
//
// ⚠ THE POINT OF THIS FILE IS THE LAST DESCRIBE BLOCK.
//
// There are THREE age implementations in shared/ and TWO age-bracket
// implementations, and every filed DOH figure is built on them:
//
//   shared/age.ts              calculateAge(birthdate)        → number | null
//   shared/dohAggregate.ts     ageAt(birthdate, on)           → number | null
//   shared/studentValidation.ts ageOn(birth, on = new Date()) → number
//
//   shared/age.ts              getAgeGroup(age)   → '4 & below' | '5-9' | …
//   shared/dohAggregate.ts     bracketOf(age)     → '4 yrs & below' | '5-9 yrs' | …
//                              (module-private, exercised through tallyByBracket)
//
// `age.ts`'s own header warns about exactly this: "a second copy is how two
// screens end up disagreeing about which bracket a 9-year-old is in — the DOH
// reports are built on these boundaries, so a divergence would be a reporting
// error, not a cosmetic one." There are now three copies.
//
// They AGREE today. These tests pin them together so that if anyone changes
// one, the disagreement fails loudly here instead of quietly in a report filed
// with the City Health Office. Recorded as BUG-02.

import { describe, it, expect } from 'vitest';
import { calculateAge, getAgeGroup, AGE_GROUPS } from './age';
import { ageAt } from './dohAggregate';
import { ageOn } from './studentValidation';

describe('calculateAge', () => {
  it('returns null for an unparseable birthdate rather than NaN', () => {
    expect(calculateAge('not-a-date')).toBeNull();
    expect(calculateAge('')).toBeNull();
  });

  it('counts whole years as of today', () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 10);
    expect(calculateAge(d.toISOString().slice(0, 10))).toBe(10);
  });
});

describe('getAgeGroup', () => {
  it('maps each boundary to its bracket', () => {
    expect(getAgeGroup(0)).toBe('4 & below');
    expect(getAgeGroup(4)).toBe('4 & below');
    expect(getAgeGroup(5)).toBe('5-9');
    expect(getAgeGroup(9)).toBe('5-9');
    expect(getAgeGroup(10)).toBe('10-14');
    expect(getAgeGroup(14)).toBe('10-14');
    expect(getAgeGroup(15)).toBe('15-19');
    expect(getAgeGroup(19)).toBe('15-19');
    expect(getAgeGroup(20)).toBe('20 & above');
    expect(getAgeGroup(99)).toBe('20 & above');
  });

  it('returns Unknown for a null age — never guesses a bracket', () => {
    expect(getAgeGroup(null)).toBe('Unknown');
  });

  it('AGE_GROUPS lists every bracket getAgeGroup can return, in order', () => {
    const produced = [0, 5, 10, 15, 20].map(getAgeGroup);
    expect(produced).toEqual([...AGE_GROUPS]);
  });
});

describe('ageAt', () => {
  it('returns null for an unparseable birthdate', () => {
    expect(ageAt('not-a-date', new Date('2026-06-15'))).toBeNull();
  });

  it('is evaluated at the DATE PASSED IN, not today (Sprint 57b)', () => {
    // The same pupil is 10 at one examination and 11 at the next. A report for
    // last school year must use last year's age, which is the whole reason
    // this function takes `on` and calculateAge does not.
    expect(ageAt('2015-06-15', new Date('2026-01-01'))).toBe(10);
    expect(ageAt('2015-06-15', new Date('2026-07-01'))).toBe(11);
  });

  it('does not tick over until the birthday itself', () => {
    expect(ageAt('2015-06-15', new Date('2026-06-14'))).toBe(10);
    expect(ageAt('2015-06-15', new Date('2026-06-15'))).toBe(11);
  });
});

describe('⚠ the three age implementations must agree', () => {
  const ON = new Date('2026-06-15');
  // Spread across every bracket boundary, plus both sides of a birthday.
  const BIRTHDAYS = [
    '2022-06-15', // exactly 4
    '2021-06-16', // 4, one day short of 5
    '2021-06-15', // exactly 5
    '2016-06-15', // exactly 10
    '2011-06-15', // exactly 15
    '2006-06-15', // exactly 20
    '2015-02-28',
    '2016-12-31',
    '2016-02-29', // leap day
  ];

  it('ageAt and ageOn return the same number for the same instant', () => {
    for (const b of BIRTHDAYS) {
      expect(ageAt(b, ON), `birthday ${b}`).toBe(ageOn(b, ON));
    }
  });

  it('calculateAge agrees with ageAt when ageAt is asked for today', () => {
    const today = new Date();
    for (const b of BIRTHDAYS) {
      expect(calculateAge(b), `birthday ${b}`).toBe(ageAt(b, today));
    }
  });

  it('⚠ ageOn is the ODD ONE OUT on a bad date: NaN, where the others give null', () => {
    // Pinned, not endorsed. It is safe TODAY only because validateBirthdate
    // guards with Number.isNaN(d.getTime()) before ever calling ageOn. Any new
    // caller that skips that guard gets NaN, and NaN silently fails every
    // comparison rather than failing loudly. See BUG-02.
    expect(Number.isNaN(ageOn('not-a-date', ON))).toBe(true);
    expect(calculateAge('not-a-date')).toBeNull();
    expect(ageAt('not-a-date', ON)).toBeNull();
  });
});
