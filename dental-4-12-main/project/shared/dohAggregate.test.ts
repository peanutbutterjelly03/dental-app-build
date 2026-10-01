// CHARACTERIZATION tests for the figures that get FILED — Sprint 161.
//
// `tallyIptrServices` produces the "1st application / 2nd application" columns
// of the DOH Oral Health Program report. Its own docblock records a real
// regression caught by diffing filed numbers: an earlier attempt at the
// linked-chart rule moved sdf_1st from 9 to 7 and sdf_2nd from 0 to 2. That is
// the kind of change these tests exist to make fail loudly instead of quietly.
//
// ⚠ These lock in CURRENT behaviour. A failure means behaviour changed and
// somebody has to decide which side was right — not that the test is wrong.

import { describe, it, expect } from 'vitest';
import { tallyIptrServices, ageAt, type AggChart, type AggTooth } from './dohAggregate';

const chart = (id: string, date: string, visit?: 1 | 2 | null): AggChart => ({
  _id: id,
  iptr_id: 'iptr-1',
  date_charted: date,
  visit_number: visit ?? null,
});

const teeth = (chartId: string, ...codes: (string | null)[]): AggTooth[] =>
  codes.map((c) => ({ chart_id: chartId, treatment_code: c }));

describe('tallyIptrServices — tooth counts', () => {
  it('counts every tooth carrying a code, across all chartings', () => {
    const charts = [chart('c1', '2026-06-01'), chart('c2', '2026-11-01')];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV', 'FV', 'PFS')],
      ['c2', teeth('c2', 'FV')],
    ]);
    const { teethByCode } = tallyIptrServices(charts, byChart);
    expect(teethByCode).toEqual({ FV: 3, PFS: 1 });
  });

  it('ignores teeth with no treatment code', () => {
    const byChart = new Map([['c1', teeth('c1', 'FV', null, undefined as unknown as string, '')]]);
    const { teethByCode } = tallyIptrServices([chart('c1', '2026-06-01')], byChart);
    expect(teethByCode).toEqual({ FV: 1 });
  });

  it('returns empty tallies for a pupil with no chartings', () => {
    const { teethByCode, codesByVisit } = tallyIptrServices([], new Map());
    expect(teethByCode).toEqual({});
    expect(codesByVisit[1].size).toBe(0);
    expect(codesByVisit[2].size).toBe(0);
  });
});

describe('tallyIptrServices — the ordinal, UNLINKED chartings (the pre-Sprint-150 rule)', () => {
  it('one sitting with a code is a 1st application only', () => {
    const byChart = new Map([['c1', teeth('c1', 'FV')]]);
    const { codesByVisit } = tallyIptrServices([chart('c1', '2026-06-01')], byChart);
    expect([...codesByVisit[1]]).toEqual(['FV']);
    expect([...codesByVisit[2]]).toEqual([]);
  });

  it('two sittings carrying a code make it a 1st AND a 2nd application', () => {
    const charts = [chart('c1', '2026-06-01'), chart('c2', '2026-11-01')];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV')],
      ['c2', teeth('c2', 'FV')],
    ]);
    const { codesByVisit } = tallyIptrServices(charts, byChart);
    expect([...codesByVisit[1]]).toEqual(['FV']);
    expect([...codesByVisit[2]]).toEqual(['FV']);
  });

  it('counts SITTINGS, not teeth — several teeth varnished in one visit is ONE application', () => {
    const byChart = new Map([['c1', teeth('c1', 'FV', 'FV', 'FV', 'FV', 'FV')]]);
    const { codesByVisit, teethByCode } = tallyIptrServices([chart('c1', '2026-06-01')], byChart);
    expect(teethByCode.FV).toBe(5); // five teeth
    expect([...codesByVisit[2]]).toEqual([]); // but still only one application
  });

  it('⚠ a code appearing only in a THIRD charting still counts as a 1st application', () => {
    // The regression the docblock records. A "fill the first two slots" rule
    // dropped this code entirely; the rule is per CODE, not per chart.
    const charts = [chart('c1', '2026-06-01'), chart('c2', '2026-09-01'), chart('c3', '2026-12-01')];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV')],
      ['c2', teeth('c2', 'FV')],
      ['c3', teeth('c3', 'SDF')],
    ]);
    const { codesByVisit } = tallyIptrServices(charts, byChart);
    expect(codesByVisit[1].has('SDF')).toBe(true);
    expect(codesByVisit[2].has('SDF')).toBe(false);
  });

  it('is not sensitive to the order the charts arrive in', () => {
    const byChart = new Map([
      ['c1', teeth('c1', 'FV')],
      ['c2', teeth('c2', 'SDF')],
    ]);
    const forwards = tallyIptrServices([chart('c1', '2026-06-01'), chart('c2', '2026-11-01')], byChart);
    const backwards = tallyIptrServices([chart('c2', '2026-11-01'), chart('c1', '2026-06-01')], byChart);
    expect([...forwards.codesByVisit[1]].sort()).toEqual([...backwards.codesByVisit[1]].sort());
    expect(forwards.teethByCode).toEqual(backwards.teethByCode);
  });
});

describe('tallyIptrServices — the ordinal, LINKED chartings (Sprint 150)', () => {
  it('a linked charting STATES its visit, and no date order overrides it', () => {
    // c2 is chronologically second but linked to visit 1; c1 is first but
    // linked to visit 2. The link wins.
    const charts = [chart('c1', '2026-06-01', 2), chart('c2', '2026-11-01', 1)];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV')],
      ['c2', teeth('c2', 'SDF')],
    ]);
    const { codesByVisit } = tallyIptrServices(charts, byChart);
    expect([...codesByVisit[2]]).toEqual(['FV']);
    expect([...codesByVisit[1]]).toEqual(['SDF']);
  });

  it('a linked charting is excluded from the sittings tally, so it cannot be counted twice', () => {
    const charts = [chart('c1', '2026-06-01', 1), chart('c2', '2026-11-01')];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV')],
      ['c2', teeth('c2', 'FV')],
    ]);
    const { codesByVisit } = tallyIptrServices(charts, byChart);
    // c2 alone is one unlinked sitting -> 1st. c1 states visit 1. Neither
    // promotes FV to a 2nd application.
    expect(codesByVisit[1].has('FV')).toBe(true);
    expect(codesByVisit[2].has('FV')).toBe(false);
  });

  it('⚠ with NOTHING linked, reproduces the pre-Sprint-150 numbers exactly', () => {
    // The compatibility guarantee the docblock makes, and the one that matters:
    // all real data today is unlinked, so this must not move filed returns.
    const charts = [chart('c1', '2026-06-01'), chart('c2', '2026-11-01')];
    const byChart = new Map([
      ['c1', teeth('c1', 'FV', 'PFS')],
      ['c2', teeth('c2', 'FV')],
    ]);
    const { teethByCode, codesByVisit } = tallyIptrServices(charts, byChart);
    expect(teethByCode).toEqual({ FV: 2, PFS: 1 });
    expect([...codesByVisit[1]].sort()).toEqual(['FV', 'PFS']);
    expect([...codesByVisit[2]]).toEqual(['FV']);
  });
});

describe('ageAt — age is taken at EXAMINATION date, not today (Sprint 57b)', () => {
  it('puts a pupil in the bracket they were in at the time', () => {
    // A mistyped birthday silently shifts a pupil into the wrong DOH age
    // bracket and the report still looks authoritative, so this is the
    // arithmetic the brackets rest on.
    expect(ageAt('2016-06-15', new Date('2026-06-14'))).toBe(9);
    expect(ageAt('2016-06-15', new Date('2026-06-15'))).toBe(10);
  });

  it('returns null rather than a number for an unusable birthdate', () => {
    expect(ageAt('', new Date('2026-06-15'))).toBeNull();
    expect(ageAt('not-a-date', new Date('2026-06-15'))).toBeNull();
  });
});
