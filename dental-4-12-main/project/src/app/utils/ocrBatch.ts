// O3 (2026-10-01): bulk OCR. Several forms are read in one go, then reviewed
// one at a time on the Verify screen; nothing saves without review.
//
// ONE FILE = ONE STUDENT, never one page = one student: the official IPTR is
// two pages (page 2 is the dental chart), so splitting a PDF per page would
// turn every two-page record into two half-students.

/** Each form takes ~15-25 s to read; 20 is roughly 5-8 minutes of waiting. */
export const MAX_BATCH_FILES = 20;

export const isSpreadsheet = (name: string) => /\.(csv|xlsx|xls)$/i.test(name);

/** Why this selection cannot be read as a batch, or null when it can. */
export function batchProblem(names: string[]): string | null {
  if (names.length > MAX_BATCH_FILES) return `Choose up to ${MAX_BATCH_FILES} forms at a time (${names.length} selected).`;
  if (names.length > 1 && names.some(isSpreadsheet)) {
    return 'A spreadsheet is read on its own. Remove it from this batch, or use Import for many rows.';
  }
  return null;
}

export type BatchOutcome = 'saved' | 'skipped';

/** The closing message after the last form in a batch. */
export function batchSummary(outcomes: BatchOutcome[]): string {
  const saved = outcomes.filter((o) => o === 'saved').length;
  const skipped = outcomes.length - saved;
  return `Batch done: ${saved} saved, ${skipped} skipped.`;
}
