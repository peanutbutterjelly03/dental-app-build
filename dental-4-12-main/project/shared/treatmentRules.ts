// Which treatment codes may be charted on a tooth, by the CONDITION it was charted with.
// Treatments are charted one tooth at a time, and the palette shows only the codes below
// for that tooth's condition (user, 2026-10-11, from the clinic's own table).
//
// The user's table:
//   Sound            -> PFS
//   D/d Decayed      -> filling (CO, GI or ART), TF, or SDF
//   M/m Missing      -> Pontic
//   F/f Filled       -> treated already
//   X/x Extraction   -> Extraction, or SDF
//   Un/un Unerupted  -> no treatment recommendation (the permanent tooth has not erupted)
//   S/s Supernumerary-> Extraction
//   JC/jc, P/p       -> treated already
//
// SDF is a label, not a code you can mark: only SDF1 (first application) and SDF2 (second
// application) can be charted (user, 2026-10-11), so SDF never appears in a list below.
//
// ⚠ Two rows were NOT in the user's table and are decided here, on the user's instruction to
// decide from the available codes ("I don't know myself"):
//   - RF/rf Root Fragment -> Extraction. A retained root fragment is removed, and Extraction is
//     the only code in this vocabulary that does that (the same answer as Supernumerary).
//   - D/d Decayed also offers TF for EVERY decayed tooth. The user wrote "TF, depending on the
//     severity", but the chart records no severity, so the dentist chooses; a temporary filling
//     is an interim restoration used when a tooth cannot be finished in one visit.
// Change a row here and the palette follows; nothing else holds these rules.

/** `none`, when set, is the reason this tooth gets no treatment; `codes` is then empty. */
export type TreatmentOptions = { codes: string[]; none?: string };

const NO_TREATMENT_ERUPTED = 'No treatment recommendation. The permanent tooth has not erupted yet.';
const TREATED_ALREADY = 'Treated already. No treatment needed.';

const RULES: Record<string, TreatmentOptions> = {
  '✓': { codes: ['PFS'] },
  D: { codes: ['CO', 'GI', 'ART', 'TF', 'SDF1', 'SDF2'] },
  M: { codes: ['P'] },
  F: { codes: [], none: TREATED_ALREADY },
  X: { codes: ['X', 'SDF1', 'SDF2'] },
  UN: { codes: [], none: NO_TREATMENT_ERUPTED },
  S: { codes: ['X'] },
  JC: { codes: [], none: TREATED_ALREADY },
  P: { codes: [], none: TREATED_ALREADY },
  RF: { codes: ['X'] },
};

/** The condition as the rules know it: upper or lower case, the old DX/dx spelling of X/x,
 *  and the two spellings of the sound-tooth check. */
function ruleKey(condition: string): string | null {
  const c = condition.trim().toUpperCase();
  if (c === '√' || c === '✓') return '✓';
  if (c === 'DX') return 'X';
  return c in RULES ? c : null;
}

/** What may be charted on a tooth with this condition. A tooth with no condition (or one this
 *  table does not cover) gets no codes and no message. */
export function treatmentOptionsFor(condition: string | undefined | null): TreatmentOptions {
  const key = condition ? ruleKey(condition) : null;
  return key ? RULES[key] : { codes: [] };
}
