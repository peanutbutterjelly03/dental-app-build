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
//
// ⚠ BUG-02 FIXED 2026-09-29: `ageAt` and `ageOn` now DELEGATE to `age.ts`, so
// the agreement below holds by construction. The tests stay as the guard
// against anyone re-growing a copy.

import { describe, it, expect } from 'vitest';
import { calculateAge, getAgeGroup, AGE_GROUPS, DOH_AGE_BRACKETS, ageBracketIndex } from './age';
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

  it('all three give null on a bad or missing date — the NaN odd-one-out is gone (BUG-02 fixed)', () => {
    // ageOn used to return NaN here, and five local copies elsewhere returned
    // NaN or 0. NaN fails every comparison silently: it filed pupils under
    // "20 & above" and "15-19". null is the one answer, everywhere.
    for (const bad of ['not-a-date', '']) {
      expect(ageOn(bad, ON), bad).toBeNull();
      expect(calculateAge(bad), bad).toBeNull();
      expect(ageAt(bad, ON), bad).toBeNull();
    }
    expect(ageOn(null, ON)).toBeNull();
    expect(ageOn(undefined, ON)).toBeNull();
  });
});

describe('ageBracketIndex / the two label sets (BUG-02)', () => {
  it('both label sets index the SAME boundaries', () => {
    expect(AGE_GROUPS.length).toBe(DOH_AGE_BRACKETS.length);
    for (const [age, i] of [[0, 0], [4, 0], [5, 1], [9, 1], [10, 2], [14, 2], [15, 3], [19, 3], [20, 4], [99, 4]] as const) {
      expect(ageBracketIndex(age), `age ${age}`).toBe(i);
    }
  });

  it('an unknown age has no bracket — never the last one by fall-through', () => {
    expect(ageBracketIndex(null)).toBeNull();
    expect(ageBracketIndex(NaN)).toBeNull();
    expect(getAgeGroup(NaN)).toBe('Unknown');
  });

  it('⚠ the DOH form labels are EXACTLY what the report tallies are keyed by', () => {
    // Changing one of these re-keys a filed DOH figure. Change them only
    // together with the form.
    expect([...DOH_AGE_BRACKETS]).toEqual(['4 yrs & below', '5-9 yrs', '10-14 yrs', '15-19 yrs', '20 yrs & above']);
  });
});
