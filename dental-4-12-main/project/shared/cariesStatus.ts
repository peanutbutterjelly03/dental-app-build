// ─── Caries status: the DOH workbook's "Yes or No - Caries Experience" group ──
//
// ONE definition for every screen that shows these five figures (2026-10-01):
// the Target Client List (which files them with the City Health Office) and the
// Risk Classification redesign. Two copies would eventually disagree about the
// same child, on a form and on a clinical screen.
//
// Caries EXPERIENCE means decayed, missing or filled: a treated tooth still
// counts. Caries ACTIVE means currently decayed. The form asks both.
//
// Input is the pupil's tooth-condition counts keyed by charting code, as the
// Target Client List already builds them: D/M/F/X permanent, d/f/x temporary,
// plus the two sound codes. `x`/`X` (for extraction) are not caries experience.
//
// Nothing here may import mongoose or React.

import { SOUND_PERMANENT, SOUND_TEMPORARY } from './rpcTracking.js';

export interface CariesStatus {
  withCariesExperience: boolean;
  inTemporaryTeeth: boolean;
  inPermanentDentition: boolean;
  withActiveCaries: boolean;
  /** Teeth charted SOUND (✓), temporary + permanent. Null when nothing at all
   *  is charted: an unexamined mouth is "not recorded", never "0 caries-free".
   *  Only charted teeth count, so a tooth nobody ticked is never claimed
   *  healthy (user decision 2026-10-01). */
  cariesFreeTeeth: number | null;
}

/** Condition counts from charted teeth, in the shape `cariesStatus` reads.
 *  A sound tooth is stored as '✓' for BOTH dentitions (the chart also accepts
 *  '√'), so it is split by tooth number: FDI 51+ are primary teeth. Same split
 *  as `rpcTracking.ts` conditionToothCounts, which feeds the Target Client List. */
export function conditionCounts(teeth: { tooth: number; condition: string | null | undefined }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of teeth) {
    if (!t.condition) continue;
    const key = t.condition === '✓' || t.condition === '√'
      ? (t.tooth >= 51 ? SOUND_TEMPORARY : SOUND_PERMANENT)
      : t.condition;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function cariesStatus(counts: Record<string, number | undefined>): CariesStatus {
  const n = (code: string) => counts[code] ?? 0;
  const permanentDmf = n('D') + n('M') + n('F');
  const temporaryDf = n('d') + n('f');
  const anythingCharted = Object.values(counts).some((v) => (v ?? 0) > 0);
  return {
    withCariesExperience: permanentDmf + temporaryDf > 0,
    inTemporaryTeeth: temporaryDf > 0,
    inPermanentDentition: permanentDmf > 0,
    withActiveCaries: n('D') + n('d') > 0,
    cariesFreeTeeth: anythingCharted ? n(SOUND_TEMPORARY) + n(SOUND_PERMANENT) : null,
  };
}
