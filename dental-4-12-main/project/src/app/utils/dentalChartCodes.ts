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

export type ChartEntry = { condition: string; treatment: string };

// ─── FDI tooth layout ─────────────────────────────────────────────────────────
export const upperPermanent = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const lowerPermanent = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const upperTemporary = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const lowerTemporary = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
export const temporaryTeeth = new Set([...upperTemporary, ...lowerTemporary]);

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
};

// ─── DMFT calculation ─────────────────────────────────────────────────────────
export const computeDMFT = (chart: Record<number, ChartEntry>) => {
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

// The three codes that describe the whole mouth, not a tooth. They have their
// own rows in the Treatment Summary, above the per-tooth table — her split.
//
// ⚠ A code listed here still appears in the per-tooth table WHEN TEETH ARE
// CHARTED WITH IT. The palette allows it, so filtering blindly would make a
// charted FV vanish from the summary; a summary that hides a charted tooth is
// worse than one row too many.
export const WHOLE_MOUTH_TREATMENT_CODES = ['OEX', 'FV', 'OP'];

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
];
export const conditionCodes = [...commonConditionCodes, ...rareConditionCodes];

// Base44-exact treatment codes
// `local` is the word the clinic and the families actually use. The clinical
// term stays primary — DOH forms and the manuscript use it — and the local term
// is shown beside it so staff reading a screen mid-appointment, and a parent
// looking over their shoulder, both recognise the service. "Pasta" was already
// carried on TR before this; the rest were added 2026-09-02.
//
// ⚠ Only terms the dentist confirms should live here. A wrong local word on a
// clinical screen is worse than none — leave `local` off rather than guess.
export const treatmentCodes = [
  { code: 'OEX', label: 'Oral Exam / Checkup', local: 'Tingin' },
  { code: 'FV', label: 'Fluoride Varnish' },
  { code: 'PFS', label: 'Pit and Fissure Sealant' },
  { code: 'OP', label: 'Oral Prophylaxis', local: 'Linis' },
  { code: 'PF', label: 'Permanent Filling', local: 'Pasta' },
  { code: 'TF', label: 'Temporary Filling', local: 'Pansamantalang pasta' },
  { code: 'TR', label: 'Tooth Restoration', local: 'Pasta' },
  { code: 'X', label: 'Extraction', local: 'Bunot' },
  { code: 'SDF', label: 'Silver Diamine Fluoride' },
];

// The palette's two rows (Sprint 156). Per-tooth codes lead; the whole-mouth
// three sit behind "More" rather than being dropped, so an FV already charted
// on a tooth by an older record can still be changed or cleared.
export const perToothTreatmentCodes = treatmentCodes.filter((t) => !WHOLE_MOUTH_TREATMENT_CODES.includes(t.code));
export const wholeMouthTreatmentCodes = treatmentCodes.filter((t) => WHOLE_MOUTH_TREATMENT_CODES.includes(t.code));

/** "Extraction (Bunot)" where a local term exists, otherwise just the label. */
export const treatmentLabel = (t: { label: string; local?: string }) =>
  t.local ? `${t.label} (${t.local})` : t.label;
