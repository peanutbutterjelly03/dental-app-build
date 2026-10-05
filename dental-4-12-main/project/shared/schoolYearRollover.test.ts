import { describe, it, expect } from 'vitest';
import { isLaterSchoolYear, plannedStartProblem, rolloverStatus, canRequestEarlyStart, SCHOOL_YEAR_DATE_RULES } from './schoolYearRollover';

describe('isLaterSchoolYear', () => {
  it('is true only for a later year', () => {
    expect(isLaterSchoolYear('2027-2028', '2026-2027')).toBe(true);
    expect(isLaterSchoolYear('2026-2027', '2026-2027')).toBe(false);
    expect(isLaterSchoolYear('2025-2026', '2026-2027')).toBe(false);
    expect(isLaterSchoolYear('junk', '2026-2027')).toBe(false);
  });
});

describe('plannedStartProblem', () => {
  const now = new Date(2026, 9, 1); // Oct 1, 2026: school year 2026-2027 is running, ends Apr 30, 2027
  it('accepts a June date in the next calendar year', () => {
    expect(plannedStartProblem('2027-06-07', now)).toBeNull();
  });
  it('accepts May 1 (first day after the year ends) and Dec 31', () => {
    expect(plannedStartProblem('2027-05-01', now)).toBeNull();
    expect(plannedStartProblem('2027-12-31', now)).toBeNull();
  });
  // These two test the DATE RULES, which the testing switch turns off
  // (SCHOOL_YEAR_DATE_RULES = false). They skip while it is off and run again
  // the moment it is set back to true, so they cannot be forgotten.
  it.skipIf(!SCHOOL_YEAR_DATE_RULES)('rejects a date inside the school year still running', () => {
    expect(plannedStartProblem('2027-04-30', now)).toMatch(/cannot start before/);
    expect(plannedStartProblem('2026-10-02', now)).toMatch(/cannot start before/);
  });
  it.skipIf(!SCHOOL_YEAR_DATE_RULES)('rejects two years ahead', () => {
    expect(plannedStartProblem('2028-06-01', now)).toMatch(/next school year/);
  });
  it('rejects malformed and impossible dates', () => {
    expect(plannedStartProblem('', now)).toBe('Choose a valid date.');
    expect(plannedStartProblem('2027-02-30', now)).toBe('Choose a valid date.');
    expect(plannedStartProblem(20270607, now)).toBe('Choose a valid date.');
  });
});

describe('rolloverStatus / canRequestEarlyStart', () => {
  it('maps rows to a status', () => {
    expect(rolloverStatus(null)).toBe('not_started');
    expect(rolloverStatus({ status: 'planned' })).toBe('not_started');
    expect(rolloverStatus({ status: 'requested' })).toBe('requested');
    expect(rolloverStatus({ status: 'declined' })).toBe('declined');
    expect(rolloverStatus({ status: 'started' })).toBe('started');
  });
  it('lets a school ask once: only before it has any row', () => {
    expect(canRequestEarlyStart('not_started')).toBe(true);
    expect(canRequestEarlyStart('requested')).toBe(false);
    expect(canRequestEarlyStart('declined')).toBe(false);
    expect(canRequestEarlyStart('started')).toBe(false);
  });
});
