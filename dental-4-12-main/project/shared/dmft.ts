// The DMF/dmf count, shared by the dental chart screens (through
// src/app/utils/dentalChartCodes.ts, which re-exports it) and the server's
// dashboard summary (/stats/dmft-summary). Moved here UNCHANGED from
// dentalChartCodes.ts on 2026-10-04 (dashboard audit item 15) so the dashboard
// can never count a mouth differently from the chart it came from.

export type ChartEntry = { condition: string; treatment: string; visitNumber?: 1 | 2 | null };

export const upperTemporary = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const lowerTemporary = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
export const temporaryTeeth = new Set([...upperTemporary, ...lowerTemporary]);

export const computeDMFT = (chart: Record<number, { condition: string }>) => {
  let d = 0, m = 0, f = 0, x = 0, D = 0, M = 0, F = 0, X = 0;
  Object.entries(chart).forEach(([tooth, data]) => {
    const n = parseInt(tooth);
    const c = data.condition;
    if (temporaryTeeth.has(n)) {
      if (c === 'd') d++;
      else if (c === 'm') m++;
      else if (c === 'f') f++;
      else if (c === 'x' || c === 'dx') x++;
    } else {
      if (c === 'D') D++;
      else if (c === 'M') M++;
      else if (c === 'F') F++;
      else if (c === 'X' || c === 'DX') X++;
    }
  });
  return { d, m, f, x, t: d + m + f + x, D, M, F, X, T: D + M + F + X };
};

// ─── Dashboard summary (dashboard audit item 15) ─────────────────────────────

// `mean` is what the dashboard shows (user decision 2026-10-04): the DOH/WHO
// convention reports the AVERAGE DMF/dmf, so the figure compares directly with
// the official forms. Median and quartiles stay available for a later view.
export interface Spread { mean: number; median: number; q1: number; q3: number; max: number }
export interface DmftSummary {
  /** Pupils with at least one charting that recorded a tooth. Everyone else is
   *  "not charted" and is left out of every figure, never counted as 0. */
  charted: number;
  /** Permanent teeth (DMFT) and primary teeth (dmft), over the charted pupils. */
  permanent: Spread | null;
  primary: Spread | null;
  /** Caries experience: DMFT + dmft above 0. */
  withCariesExperience: number;
}

/** Linear-interpolated quantile of an ascending list (the common "type 7"). */
function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function spread(values: number[]): Spread | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean, median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75), max: s[s.length - 1] };
}

/** One entry per CHARTED pupil: the result of computeDMFT on the charting that
 *  speaks for them (their latest charting that has tooth records). */
export function summarizeDmft(perPupil: { T: number; t: number }[]): DmftSummary {
  return {
    charted: perPupil.length,
    permanent: spread(perPupil.map((p) => p.T)),
    primary: spread(perPupil.map((p) => p.t)),
    withCariesExperience: perPupil.filter((p) => p.T + p.t > 0).length,
  };
}
