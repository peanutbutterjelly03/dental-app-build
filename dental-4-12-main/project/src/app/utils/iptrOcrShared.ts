// Lightweight pieces of the OCR module that the UI needs at render time.
// Kept separate from iptrOcr.ts so importing them does NOT pull tesseract.js
// and pdfjs-dist (~1.5MB) into the main bundle — the heavy module is
// dynamic-imported only when someone actually scans a form.

// Confidence below this threshold gets flagged in the UI for manual review.
// Never trusted silently — see CLAUDE.md OCR MODULE spec.
export const OCR_CONFIDENCE_THRESHOLD = 70;

// ⚠ NO 'grade' / 'section' HERE, AND THAT IS DELIBERATE (Sprint 87).
// The official DOH IPTR's Personal Information block is: Patient's Name ·
// Birthday · Age · Sex · Address · Occupation · Contact # · Philhealth #
// (Principal/Dependent) · 4Ps/NHTS. It prints NO grade and NO section, so
// anchoring on them could only ever return nothing. The app still needs both
// — they are required on STUDENT and snapshotted per year on STUDENT_IPTR —
// they are just TYPED, not scanned. The Parents & Guardian Consent Form is
// the document that carries GRADE&SECTION; reading it is separate scope.
// 'occupation' is likewise absent: the form prints it, but no model stores it,
// so extracting it would only produce a value with nowhere to go.
export type IptrOcrFieldKey =
  | 'firstName' | 'lastName' | 'middleName' | 'birthdate' | 'age' | 'gender'
  | 'address' | 'contactNumber' | 'philhealthNumber' | 'fourPsId';

/** One detected finding from the form's Year 1-5 tick grid. Kept flat and
 *  label-first because the UI shows these for confirmation, never saves them
 *  directly — a tick detector must not write a clinical record unreviewed. */
export interface IptrCheckboxFinding {
  label: string;
  section: 'medical' | 'dietary' | 'oral';
  /** Model field this maps to, or null when the form carries the row and the
   *  data model has nowhere to store it. */
  field: string | null;
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
