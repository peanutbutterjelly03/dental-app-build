// Shared visual vocabulary for the printed DOH forms (Sprint 83).
//
// These are not decoration. On the paper forms the two treatments below MEAN
// something, and reproducing them is part of the form being recognisable as
// the form — the reason the user asked for the tables to "copy the standard
// forms" rather than merely carry the right numbers.
//
// SAMPLED, NOT GUESSED. Measured off the manuscript's Appendix F scan
// (`image18`, 730x498) on 2026-09-03 by averaging the pixels of each region:
//   * section bands  ~ rgb(232, 195,  95)
//   * blocked cells  ~ rgb( 86,  86,  86)
//
// ⚠ Those are values off a SCANNED PHOTOGRAPH, so they carry the scan's warmth
// and exposure. The tokens below match the scan's INTENT rather than its
// measured RGB: the underlying document is near-certainly a standard Office
// amber, and a washed-out scan value would look muddy on screen and worse in
// print. If the source workbook ever reaches this machine, read the real fill
// colours from it and correct these two constants — that is the authoritative
// answer, and this is the informed approximation.

/** Section band — "A. Patient Seeking Utilization", "B. Oral Health Status".
 *  A filled amber rule across the full table width on the paper form. */
export const FORM_SECTION_BAND = 'bg-[#f5c842] text-black';

/** A cell the paper form BLOCKS OUT in solid dark grey: it must not be filled.
 *  This is NOT the same as a cell the system has no data for — that one stays
 *  empty with a dash, because the form still wants a number there. Conflating
 *  them would tell a reader the form forbids a cell it merely leaves blank. */
export const BLOCKED_CELL = 'bg-[#565656]';

/** The narrow second label column the form uses for an indicator's sub-rows
 *  — "1st Scaling / 2nd Scaling", "Head Count / Tooth Count". Printed in a
 *  light lavender that separates it from both the indicator column and the
 *  value grid.
 *
 *  SAMPLED the same way as the two above, from the FILED Jan 2026 Oral Health
 *  Program Reporting Form (`ohprf-1.png` at 200dpi) on 2026-09-03: the sub-row
 *  label cells average ~rgb(224, 216, 227), and the amber band on that same
 *  scan measured rgb(228, 189, 93) — within three points of the token above,
 *  which is what makes this sample trustworthy rather than a guess. */
export const FORM_SUBROW_LABEL = 'bg-[#e6dfe9]';

/** Tooltip for a blocked cell, so the styling is explained rather than
 *  mysterious to anyone who did not grow up with the form. */
export const BLOCKED_TITLE =
  'Blocked on the printed form — this cell is not applicable and must not be filled.';
