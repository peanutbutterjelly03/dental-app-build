// CHARACTERIZATION tests — Sprint 161.
//
// The DepEd school year (June–April) is the boundary every per-year figure
// hangs off: which IPTR a visit belongs to, which year a DOH report covers,
// and whether an RPC second visit can still fit before the year closes. The
// module's own rule is that "every date belongs to exactly one school year",
// so these check the three functions agree — including on May, which falls
// outside the calendar and is bucketed forward on purpose.

import { describe, it, expect } from 'vitest';
import { schoolYearStart, schoolYearEnd, schoolYearLabel, nextSchoolYear } from './schoolYear';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('schoolYearStart / schoolYearEnd / schoolYearLabel agree', () => {
  const CASES: Array<[string, string, string, string]> = [
    // date        → start        end           label
    ['2026-06-01', '2026-06-01', '2027-04-30', '2026-2027'], // first day
    ['2026-09-15', '2026-06-01', '2027-04-30', '2026-2027'], // mid-year
    ['2026-12-31', '2026-06-01', '2027-04-30', '2026-2027'], // across new year
    ['2027-01-01', '2026-06-01', '2027-04-30', '2026-2027'], // still the same SY
    ['2027-04-30', '2026-06-01', '2027-04-30', '2026-2027'], // last day
    ['2027-05-15', '2027-06-01', '2028-04-30', '2027-2028'], // ⚠ May bucketed FORWARD
  ];

  for (const [date, start, end, label] of CASES) {
    it(`${date} → ${label}`, () => {
      const d = new Date(date);
      expect(iso(schoolYearStart(d))).toBe(start);
      expect(iso(schoolYearEnd(d))).toBe(end);
      expect(schoolYearLabel(d)).toBe(label);
    });
  }

  it('every date lands in exactly one school year — no gap at the May seam', () => {
    // April 30 closes a year and June 1 opens the next; May belongs to the
    // year about to start, so nothing falls between them.
    expect(schoolYearLabel(new Date('2027-04-30'))).toBe('2026-2027');
    expect(schoolYearLabel(new Date('2027-05-01'))).toBe('2027-2028');
    expect(schoolYearLabel(new Date('2027-06-01'))).toBe('2027-2028');
  });
});

describe('⚠ schoolYearEnd returns the START of the last day, not the end of it', () => {
  it('is April 30 at 00:00, so most of April 30 sorts AFTER the year end', () => {
    // Pinned, not endorsed — see the ledger note for Sprint 161.
    //
    // rpcTracking compares `windowCloses > syEnd.getTime()` to decide whether a
    // second RPC visit still fits before the year closes, and displays the
    // deadline as "2027-04-30". A window closing at 09:00 on April 30 is
    // therefore past the enforced deadline while still inside the displayed
    // one. The two disagree by up to 24 hours.
    const end = schoolYearEnd(new Date('2026-09-01'));
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);

    const duringLastDay = new Date('2027-04-30T09:00:00').getTime();
    expect(duringLastDay > end.getTime()).toBe(true);
  });
});

describe('nextSchoolYear', () => {
  it('advances both halves', () => {
    expect(nextSchoolYear('2026-2027')).toBe('2027-2028');
  });

  it('returns the input unchanged when it is not a year pair, rather than inventing one', () => {
    expect(nextSchoolYear('')).toBe('');
    expect(nextSchoolYear('not-a-year')).toBe('not-a-year');
    expect(nextSchoolYear('2026')).toBe('2026');
  });
});
