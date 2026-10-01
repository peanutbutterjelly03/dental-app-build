// CHARACTERIZATION tests for the DMF/dmf count — Sprint 162.
//
// Sprint 158 wanted these and could not have them: `computeDMFT` was
// module-local inside a 3,088-line component, and it recorded that extracting
// it was this sprint's job. This is that payoff — the extraction is what made
// the arithmetic testable.
//
// Why it matters: the DMF/dmf index is CLAUDE.md's PRIMARY feature for the
// predictive model and a printed column on the DOH IPTR. It is the single
// number the whole Phase 3 pipeline is built on.

import { describe, it, expect } from 'vitest';
import {
  computeDMFT,
  dmftRecordsForYear,
  conditionCodes,
  treatmentCodes,
  treatmentLabel,
  conditionColors,
  perToothTreatmentCodes,
  wholeMouthTreatmentCodes,
  upperPermanent,
  lowerPermanent,
  upperTemporary,
  lowerTemporary,
  type ChartEntry,
} from './dentalChartCodes';

const chart = (entries: Record<number, string>): Record<number, ChartEntry> =>
  Object.fromEntries(Object.entries(entries).map(([t, condition]) => [t, { condition, treatment: '' }]));

describe('computeDMFT — permanent vs temporary teeth', () => {
  it('counts an empty chart as all zeroes', () => {
    expect(computeDMFT({})).toEqual({ d: 0, m: 0, f: 0, x: 0, t: 0, D: 0, M: 0, F: 0, X: 0, T: 0 });
  });

  it('routes UPPERCASE codes on permanent teeth to the permanent tally', () => {
    // 16 is an upper permanent molar.
    const r = computeDMFT(chart({ 16: 'D', 26: 'M', 36: 'F', 46: 'X' }));
    expect({ D: r.D, M: r.M, F: r.F, X: r.X, T: r.T }).toEqual({ D: 1, M: 1, F: 1, X: 1, T: 4 });
    expect(r.t).toBe(0);
  });

  it('routes lowercase codes on temporary teeth to the temporary tally', () => {
    // 55, 65, 75, 85 are deciduous.
    const r = computeDMFT(chart({ 55: 'd', 65: 'm', 75: 'f', 85: 'x' }));
    expect({ d: r.d, m: r.m, f: r.f, x: r.x, t: r.t }).toEqual({ d: 1, m: 1, f: 1, x: 1, t: 4 });
    expect(r.T).toBe(0);
  });

  it('⚠ decides by TOOTH NUMBER, not by letter case', () => {
    // An uppercase code on a deciduous tooth counts as NEITHER — the permanent
    // branch is never reached for tooth 55, and the temporary branch only
    // matches lowercase. Pinned as current behaviour, not endorsed: it means a
    // miscased entry is silently dropped from both indices rather than flagged.
    const r = computeDMFT(chart({ 55: 'D' }));
    expect(r.t).toBe(0);
    expect(r.T).toBe(0);
  });

  it('totals are the sum of their four components', () => {
    const r = computeDMFT(chart({ 16: 'D', 17: 'D', 26: 'M', 36: 'F', 55: 'd', 65: 'd', 75: 'm' }));
    expect(r.T).toBe(r.D + r.M + r.F + r.X);
    expect(r.t).toBe(r.d + r.m + r.f + r.x);
    expect(r.D).toBe(2);
    expect(r.d).toBe(2);
  });

  it('ignores sound teeth and unknown codes', () => {
    const r = computeDMFT(chart({ 16: '✓', 17: 'Un', 18: 'S', 26: 'JC', 27: 'P', 28: '' }));
    expect(r.T).toBe(0);
    expect(r.t).toBe(0);
  });
});

describe('⚠ computeDMFT accepts BOTH extraction spellings — do not "fix" this', () => {
  // HANDOFF durable gotcha, re-confirmed by the user 2026-09-03: the app's
  // extraction CONDITION code is X/x, which diverges from the printed DOH
  // legend (DX/dx) deliberately. Charts saved under either spelling must keep
  // counting, so both are accepted. This will look like a bug to the next
  // person who compares the screen with the paper form. It is not.
  it('counts X and DX alike on permanent teeth', () => {
    expect(computeDMFT(chart({ 16: 'X' })).X).toBe(1);
    expect(computeDMFT(chart({ 16: 'DX' })).X).toBe(1);
  });

  it('counts x and dx alike on temporary teeth', () => {
    expect(computeDMFT(chart({ 55: 'x' })).x).toBe(1);
    expect(computeDMFT(chart({ 55: 'dx' })).x).toBe(1);
  });

  it('gives both spellings a colour, so neither renders unstyled', () => {
    for (const code of ['X', 'x', 'DX', 'dx']) {
      expect(conditionColors[code], `colour for ${code}`).toBeTruthy();
    }
  });
});

describe('dmftRecordsForYear — which charting speaks for the year (BUG-12)', () => {
  const A = [{ t: 'a1' }, { t: 'a2' }];
  const B = [{ t: 'b1' }];

  it('takes the LATEST charting that has records', () => {
    expect(dmftRecordsForYear([A, B])).toBe(B);
  });

  it('⚠ SKIPS an empty charting that came after a recorded one — this is the fix', () => {
    // The measured case: 14 decayed teeth charted on Sep 6, an empty charting
    // opened on Sep 7, and the year reported DMFT 0 with a trend of "Stable".
    expect(dmftRecordsForYear([A, []])).toBe(A);
    expect(dmftRecordsForYear([A, [], [], []])).toBe(A);
  });

  it('returns null when NOTHING was charted all year — "not recorded", never 0', () => {
    expect(dmftRecordsForYear([])).toBeNull();
    expect(dmftRecordsForYear([[]])).toBeNull();
    expect(dmftRecordsForYear([[], [], []])).toBeNull();
  });

  it('⚠ a charting with records still counts even if every tooth is sound', () => {
    // The distinction the rule exists for: 0 means examined and no decay found;
    // null means nothing was charted. A sound mouth is a real finding.
    const allSound = [{ t: 'sound' }];
    expect(dmftRecordsForYear([allSound])).toBe(allSound);
  });

  it('does not merge chartings — it returns ONE of them, never a concatenation', () => {
    // Per the user's 2026-09-05 decision: each charting is one visit's
    // findings, read alone.
    const result = dmftRecordsForYear([A, B]);
    expect(result).toHaveLength(B.length);
    expect(result).not.toHaveLength(A.length + B.length);
  });
});

describe('the FDI layout', () => {
  it('covers 32 permanent and 20 deciduous teeth, with no overlap', () => {
    const permanent = [...upperPermanent, ...lowerPermanent];
    const temporary = [...upperTemporary, ...lowerTemporary];
    expect(permanent).toHaveLength(32);
    expect(temporary).toHaveLength(20);
    expect(new Set(permanent).size).toBe(32);
    expect(new Set(temporary).size).toBe(20);
    expect(permanent.filter((t) => temporary.includes(t))).toEqual([]);
  });
});

describe('the code tables', () => {
  it('every condition code has a colour', () => {
    for (const c of conditionCodes) {
      expect(conditionColors[c.perm], `permanent ${c.code}`).toBeTruthy();
      expect(conditionColors[c.temp], `temporary ${c.code}`).toBeTruthy();
    }
  });

  it('the palette split covers every treatment code exactly once', () => {
    // The "More" row must not drop a code: an FV charted on a tooth by an older
    // record still has to be changeable.
    const split = [...perToothTreatmentCodes, ...wholeMouthTreatmentCodes].map((t) => t.code).sort();
    expect(split).toEqual(treatmentCodes.map((t) => t.code).sort());
  });

  it('treatmentLabel appends the local term only when there is one', () => {
    expect(treatmentLabel({ label: 'Extraction', local: 'Bunot' })).toBe('Extraction (Bunot)');
    expect(treatmentLabel({ label: 'Fluoride Varnish' })).toBe('Fluoride Varnish');
  });
});
