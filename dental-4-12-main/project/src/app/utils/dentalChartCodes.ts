// The dental chart's VOCABULARY and ARITHMETIC — the FDI tooth layout, the
// condition and treatment codes, their colours, and the DMF/dmf count.
//
// Extracted from `components/DentalChart.tsx` in Sprint 162, unchanged. Two
// reasons, and the second is the one that matters:
//
//  1. Dashboard, Reports, RPCTracking and IptrForm all imported `treatmentCodes`
//     / `treatmentLabel` from a 3,088-line COMPONENT, so opening any of those
//     screens pulled the whole chart module in behind them.
//  2. None of this is React, and keeping it inside a component is what kept
//     `computeDMFT` untestable — Sprint 158 wanted it and had to record it as
//     "module-local inside DentalChart.tsx, extracting it is Sprint 162's job".
//
// ⚠ NOTHING HERE CHANGED IN THE MOVE. Comments are carried verbatim because
// several of them record decisions that cost a sprint to make.

// ChartEntry (visitNumber added 2026-09-25 -- which RPC visit this tooth's
// current treatment was recorded at, for the "(V1)"/"(V2)" indicator;
// undefined/null for teeth charted outside the visit flow), the primary-tooth
// layout and computeDMFT now live in shared/dmft.ts (2026-10-04, dashboard
// audit item 15) so the server's dashboard summary uses the same count.
// Re-exported unchanged; every importer keeps its import path.
export type { ChartEntry } from '../../../shared/dmft';
export { upperTemporary, lowerTemporary, temporaryTeeth, computeDMFT } from '../../../shared/dmft';

// ─── FDI tooth layout ─────────────────────────────────────────────────────────
export const upperPermanent = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const lowerPermanent = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export const conditionColors: Record<string, string> = {
  '✓': 'bg-green-50 border-green-400',
  '√': 'bg-green-50 border-green-400',
  'D': 'bg-red-100 border-red-400',
  'd': 'bg-red-100 border-red-300',
  'M': 'bg-slate-200 border-slate-400',
  'm': 'bg-slate-200 border-slate-300',
  'F': 'bg-blue-100 border-blue-400',
  'f': 'bg-blue-100 border-blue-300',
  'X': 'bg-orange-100 border-orange-400',
  'x': 'bg-orange-100 border-orange-300',
  // Legacy: charts saved before the code was corrected to X/x still hold DX/dx.
  'DX': 'bg-orange-100 border-orange-400',
  'dx': 'bg-orange-100 border-orange-300',
  'Un': 'bg-purple-50 border-purple-300',
  'un': 'bg-purple-50 border-purple-200',
  'S': 'bg-yellow-50 border-yellow-400',
  's': 'bg-yellow-50 border-yellow-300',
  'JC': 'bg-pink-50 border-pink-400',
  'jc': 'bg-pink-50 border-pink-300',
  'P': 'bg-indigo-50 border-indigo-400',
  'p': 'bg-indigo-50 border-indigo-300',
  'RF': 'bg-amber-100 border-amber-400',
  'rf': 'bg-amber-100 border-amber-300',
};

/**
 * Which charting speaks for a school year's DMFT? (BUG-12, decided by the user
 * 2026-09-14.)
 *
 * **The latest charting that actually HAS tooth records** — not simply the
 * latest. `null` when no charting that year recorded a single tooth, and the
 * caller must render that as "not recorded", never as 0.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT. `0` means examined and no decay found;
 * `null` means nothing was charted. A charting whose teeth are all sound has
 * records, so it correctly yields 0 rather than null.
 *
 * Not "sum every charting": the user's 2026-09-05 decision is that each
 * charting is one visit's findings, read alone and never merged.
 *
 * @param chartsOldestFirst tooth records grouped by charting, oldest charting first.
 */
export function dmftRecordsForYear<T>(chartsOldestFirst: T[][]): T[] | null {
  for (let i = chartsOldestFirst.length - 1; i >= 0; i--) {
    if (chartsOldestFirst[i].length > 0) return chartsOldestFirst[i];
  }
  return null;
}

// Base44-exact condition codes: uppercase=permanent, lowercase=temporary (auto-applied)
//
// Split into common and rare for the palette (Sprint 156, her division). Un, S,
// JC and P are charted a handful of times a year and were holding four
// permanent slots on a chairside screen. ⚠ `conditionCodes` stays the whole
// list, in the same order, because the Legend, IptrForm, Reports, RPCTracking,
// Dashboard and TargetClientList all read it — the palette collapses, the
// vocabulary does not shrink.
export const commonConditionCodes = [
  { code: '✓', label: 'Sound/Sealed', perm: '✓', temp: '✓' },
  { code: 'D', label: 'Decayed', perm: 'D', temp: 'd' },
  { code: 'M', label: 'Missing', perm: 'M', temp: 'm' },
  { code: 'F', label: 'Filled', perm: 'F', temp: 'f' },
  { code: 'X', label: 'Indicated for Extr.', perm: 'X', temp: 'x' },
];
export const rareConditionCodes = [
  { code: 'Un', label: 'Unerupted', perm: 'Un', temp: 'un' },
  { code: 'S', label: 'Supernumerary Tooth', perm: 'S', temp: 's' },
  { code: 'JC', label: 'Jacket Crown', perm: 'JC', temp: 'jc' },
  { code: 'P', label: 'Pontic', perm: 'P', temp: 'p' },
  { code: 'RF', label: 'Root Fragment', perm: 'RF', temp: 'rf' },
];
export const conditionCodes = [...commonConditionCodes, ...rareConditionCodes];

// Treatment code vocabulary moved to shared/treatmentCodes.ts (user,
// 2026-09-27) so the server can import the exact same list for
// /stats/treatment-categories, rather than a second hardcoded copy drifting
// out of sync with this one. Re-exported here unchanged -- no existing
// import site in this codebase had to move.
export {
  treatmentCodes,
  WHOLE_MOUTH_TREATMENT_CODES,
  perToothTreatmentCodes,
  wholeMouthTreatmentCodes,
  treatmentLabel,
  TREATMENT_PALETTE_GROUPS,
  TREATMENT_VARIANT_CODES,
  treatmentDisplay,
} from '../../../shared/treatmentCodes';
