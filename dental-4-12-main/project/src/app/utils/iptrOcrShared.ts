// Lightweight pieces of the OCR module that the UI needs at render time.
// Kept separate from iptrOcr.ts so importing them does NOT pull tesseract.js
// and pdfjs-dist (~1.5MB) into the main bundle — the heavy module is
// dynamic-imported only when someone actually scans a form.

// Confidence below this threshold gets flagged in the UI for manual review.
// Never trusted silently — see CLAUDE.md OCR MODULE spec.
export const OCR_CONFIDENCE_THRESHOLD = 70;

// 'grade'/'section'/'placeOfBirth'/'guardianName'/'guardianContact'/
// 'guardianOccupation' ADDED 2026-09-29, superseding the Sprint 87 note that
// used to be here ("NO grade/section, deliberate — the official DOH IPTR
// prints neither"). That was true of the official DOH IPTR specifically;
// it is not true of every source this module reads. The school's own
// "Patient Information Sheet" (a custom boxed/grid layout, not the DOH
// form) DOES print all of these, and the grid extractor below reads them
// from it. A source that genuinely lacks a field still just returns
// nothing for it — these keys are safe to always attempt.
export type IptrOcrFieldKey =
  | 'firstName' | 'lastName' | 'middleName' | 'birthdate' | 'age' | 'gender'
  | 'address' | 'contactNumber' | 'philhealthNumber' | 'fourPsId'
  | 'grade' | 'section' | 'placeOfBirth' | 'guardianName' | 'guardianContact' | 'guardianOccupation'
  // Read from a ticked checkbox (iptrTickBoxes.ts), not from text.
  | 'philhealthStatus';

/** One detected finding from the form's Year 1-5 tick grid. Kept flat and
 *  label-first because the UI shows these for confirmation, never saves them
 *  directly — a tick detector must not write a clinical record unreviewed. */
export interface IptrCheckboxFinding {
  label: string;
  section: 'medical' | 'dietary' | 'oral';
  /** Model field this maps to, or null when the form carries the row and the
   *  data model has nowhere to store it. */
  field: string | null;
  /** The row's value is free text on the form (Allergies, Others, Last
   *  Admission): a tick says "yes" but the details must be typed, and the
   *  model stores a STRING there, so a tick is never saved as `true`. */
  text?: boolean;
  /** Which Year columns were ticked (1-5). */
  years: number[];
}

export interface IptrOcrResult {
  fields: Partial<Record<IptrOcrFieldKey, string>>;
  confidences: Partial<Record<IptrOcrFieldKey, number>>;
  rawText: string;
  overallConfidence: number;
  /** Findings read from the checkbox grid — empty when it could not be read
   *  with certainty. NEVER auto-applied; see IptrCheckboxFinding. */
  checkboxes: IptrCheckboxFinding[];
  /** 0 when the grid was not readable; `checkboxReason` says why. */
  checkboxConfidence: number;
  checkboxReason?: string;
  /** Ticked rows the data model cannot store, surfaced so they are visibly
   *  dropped rather than invisibly lost. */
  unstorableFindings: string[];
}
