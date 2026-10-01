// ─── IPTR "B. Indicate Number" — one derivation, two consumers ─────────────
//
// Sprint 151. The DOH IPTR's Section B rows, computed from an odontogram.
//
// ⚠ WHY THIS IS IN `shared/` RATHER THAN IN A COMPONENT: two screens already
// needed these rows and were computing them separately — the Dental Chart tab
// (live, from the odontogram being edited) and `IptrFormV2` (saved tooth
// records, for the printed Form 1). Two implementations of one official form's
// arithmetic is how a screen and the sheet filed with the City Health Office
// end up disagreeing about the same pupil. One function, two callers.
//
// The row set, the order and the two readings below follow the collaborator's
// implementation on `peanutbutterjelly03:majorUpdates`, which got them right:
//
//  · "Present" EXCLUDES teeth recorded missing or unerupted. A tooth that is
//    not in the mouth cannot be counted as present.
//  · The temporary block is "dfx", NOT "dmfx", and the form has no "missing
//    (m)" row — primary teeth exfoliate naturally, so a missing one is not a
//    caries outcome. Followed exactly rather than "corrected".
//
// Nothing here may import React or mongoose.

/** One charted tooth: its FDI number and what was found / done on it. */
export interface ChartedTooth {
  tooth: number;
  /** Condition code as stored — case carries the dentition (`D` vs `d`). */
  condition?: string | null;
  /** Treatment code as stored (FV, PFS, PF, TF, X, SDF, …). */
  treatment?: string | null;
}

export interface SectionBRow {
  label: string;
  /** The FDI numbers behind the count, ascending. The form asks for a number;
   *  the dentist needs to know WHICH teeth, and a count alone cannot say. */
  teeth: number[];
}

/** FDI quadrants 5-8 are the primary teeth.
 *  ⚠ Dentition is decided by the TOOTH NUMBER, never by the case of the
 *  condition code: `✓` (Sound/Sealed) is the same character in both
 *  dentitions, so a case test would count every sound baby tooth as
 *  permanent. */
export function isTemporaryTooth(toothNumber: number): boolean {
  const quadrant = Math.floor(toothNumber / 10);
  return quadrant >= 5 && quadrant <= 8;
}

/** The form's Section B, in the form's own order and wording. */
export function sectionBRows(charted: ChartedTooth[]): SectionBRow[] {
  const withCondition = charted.filter((t) => !!t.condition);
  const permanent = withCondition.filter((t) => !isTemporaryTooth(t.tooth));
  const temporary = withCondition.filter((t) => isTemporaryTooth(t.tooth));

  const sorted = (list: ChartedTooth[]) => list.map((t) => t.tooth).sort((a, b) => a - b);
  const where = (list: ChartedTooth[], codes: string[]) =>
    sorted(list.filter((t) => codes.includes(t.condition as string)));
  const whereNot = (list: ChartedTooth[], codes: string[]) =>
    sorted(list.filter((t) => !codes.includes(t.condition as string)));

  return [
    { label: 'No. of Permanent Teeth Present', teeth: whereNot(permanent, ['M', 'Un']) },
    { label: 'No. of Permanent Sound Teeth', teeth: where(permanent, ['✓']) },
    { label: 'No. of Decayed Teeth (D)', teeth: where(permanent, ['D']) },
    { label: 'No. of Missing Teeth (M)', teeth: where(permanent, ['M']) },
    { label: 'No. of Filled Teeth (F)', teeth: where(permanent, ['F']) },
    { label: 'No. of Teeth for Extraction (X)', teeth: where(permanent, ['X']) },
    { label: 'No. of DMFX Teeth', teeth: where(permanent, ['D', 'M', 'F', 'X']) },
    { label: 'No. of Temporary Teeth Present', teeth: whereNot(temporary, ['m', 'un']) },
    { label: 'No. of Temporary Sound Teeth', teeth: where(temporary, ['✓']) },
    { label: 'No. of Decayed Teeth (d)', teeth: where(temporary, ['d']) },
    { label: 'No. of Filled Teeth (f)', teeth: where(temporary, ['f']) },
    { label: 'No. of Teeth for Extraction (x)', teeth: where(temporary, ['x']) },
    { label: 'No. of dfx Teeth', teeth: where(temporary, ['d', 'f', 'x']) },
  ];
}

/** Which TEETH carry each treatment code, ascending — not just how many.
 *  "3 fillings" without saying which three is not what the dentist or the form
 *  is asking. Sorted numerically so 8 does not come after 46. */
export function teethByTreatment(charted: ChartedTooth[]): Record<string, number[]> {
  const byCode: Record<string, number[]> = {};
  for (const t of charted) {
    if (!t.treatment) continue;
    (byCode[t.treatment] ??= []).push(t.tooth);
  }
  for (const list of Object.values(byCode)) list.sort((a, b) => a - b);
  return byCode;
}

/** Dental Caries for the condition summary — DERIVED from the odontogram, any
 *  tooth marked `D` or `d`.
 *
 *  ⚠ Testing only `D` silently misses every primary-tooth caries: a tooth
 *  stores the permanent code or the primary one depending on which tooth it
 *  is. Deriving it also avoids a second source of truth — caries is recorded
 *  tooth by tooth, so a separate "caries" tick would eventually disagree with
 *  the teeth above it. */
export function hasCaries(charted: ChartedTooth[]): boolean {
  return charted.some((t) => t.condition === 'D' || t.condition === 'd');
}
