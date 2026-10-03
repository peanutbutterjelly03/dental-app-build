import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Threshold + types live in iptrOcrShared.ts so the UI can import them
// without dragging tesseract/pdfjs into the main bundle.
import type { IptrOcrFieldKey, IptrOcrResult, IptrCheckboxFinding } from './iptrOcrShared';
import { readIptrCheckboxes, IPTR_FORM_ROWS, IPTR_YEARS } from './iptrCheckboxes';
export { OCR_CONFIDENCE_THRESHOLD } from './iptrOcrShared';
export type { IptrOcrFieldKey, IptrOcrResult } from './iptrOcrShared';

// Tesseract.js can only read raster images, so every page of a PDF (front
// and back of the paper form both matter) is rendered to a canvas first.
async function rasterizePdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 }); // upscale for better OCR accuracy
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create canvas context');
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

// Every label that can appear on the form, used as a stop-boundary so one
// field's capture doesn't swallow the next field's label — paper forms
// commonly print several fields on one line, e.g. "Name: ____ Sex: ____".
// This list is transcribed from the blank DOH IPTR, which prints Address,
// Occupation and Contact # on ONE line and Philhealth # and 4Ps/NHTS on the
// next — so `occupation` and `4ps/nhts` earn their place here as boundaries
// even though neither is extracted as a field of its own.
const ALL_FIELD_LABELS = [
  "student'?s name", "patient'?s name", 'pangalan', 'name',
  'birth\\s*date', 'birthday', 'date of birth',
  'age', 'sex', 'gender', 'address', 'occupation',
  'contact\\s*(?:no\\.?|number|#)', 'mobile\\s*(?:no\\.?|number|#)',
  'phil\\s*health', 'principal', 'dependent',
  '4\\s*ps\\s*[\\/|]?\\s*nhts', 'nhts',
];

// A value that's just an unfilled placeholder (underscores, slashes, "mm/dd/yyyy") — treat as blank.
function isPlaceholder(value: string): boolean {
  const stripped = value.replace(/[_\-\/\s]/g, '');
  if (!stripped) return true;
  return /^(mm|dd|yyyy)+$/i.test(stripped);
}

function findLabelValue(text: string, labels: string[]): string | null {
  const boundary = ALL_FIELD_LABELS.join('|');
  for (const label of labels) {
    // ⚠ The value is a NAMED group, not `[1]`. A label pattern containing its
    // own capturing group — `contact\s*(no|number|#)` did — takes group 1 for
    // itself, so `match[1]` returned the matched LABEL fragment as the value.
    // That is how Contact # extracted the literal string "#" onto the form.
    const re = new RegExp(`(?:${label})\\s*[:\\-]?\\s*(?<value>[\\s\\S]*?)(?=(?:${boundary})\\s*[:\\-]|[\\r\\n]|$)`, 'i');
    const match = text.match(re);
    if (match?.groups?.value) {
      const value = match.groups.value.trim().replace(/\s{2,}/g, ' ');
      if (value && !isPlaceholder(value)) return value;
    }
  }
  return null;
}

function confidenceForValue(value: string, words: Tesseract.Word[]): number | undefined {
  if (!value) return undefined;
  const tokens = value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.filter((w) => tokens.includes(w.text.toLowerCase().replace(/[^a-z0-9]/g, '')));
  if (matches.length === 0) return undefined;
  return matches.reduce((sum, w) => sum + w.confidence, 0) / matches.length;
}

// A PhilHealth PIN is 12 digits, normally printed XX-XXXXXXXXX-X. Anything
// much shorter came from a stray mark or from the "Principal / Dependent"
// caption leaking past the label, not from a real number — return blank and
// let the encoder type it, rather than prefilling a wrong identifier onto a
// child's record. Which of Principal/Dependent applies is CIRCLED on paper,
// not written, so it is not inferred here; the encoder picks it.
function normalizePhilhealth(raw: string): string {
  const cleaned = raw.replace(/[^0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return cleaned.replace(/\D/g, '').length >= 10 ? cleaned : '';
}

// 4Ps/NHTS household IDs are not one fixed format, so this cannot validate a
// shape — but it CAN insist on one: an ID contains digits. ⚠ Without that, the
// blank form's next printed line ("Lagyan ng ✓ kung ikaw ay NAKARANAS…") was
// captured, stripped of spaces, and prefilled as a 4Ps ID. A prose sentence is
// never an identifier.
function normalizeFourPs(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Za-z-]/g, '').replace(/^-|-$/g, '');
  if (cleaned.replace(/\D/g, '').length < 4) return '';
  return cleaned.length <= 24 ? cleaned : '';
}

// A one- or two-character "address" is a speck on a blank line, not a place.
// Blank fields on a scanned form routinely OCR as a stray 0 or l.
function normalizeAddress(raw: string): string {
  const value = raw.trim();
  return value.replace(/[^0-9A-Za-z]/g, '').length >= 4 ? value : '';
}

function normalizeSex(raw: string): string {
  if (/^m(ale)?$/i.test(raw.trim())) return 'Male';
  if (/^f(emale)?$/i.test(raw.trim())) return 'Female';
  return raw.trim();
}

function normalizeBirthdate(raw: string): string {
  // Handles MM/DD/YYYY, M-D-YYYY, and YYYY-MM-DD; returns YYYY-MM-DD for <input type="date">.
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const mdy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  return '';
}

function splitName(raw: string): { firstName: string; middleName: string; lastName: string } {
  // DOH IPTR forms typically print "Last Name, First Name Middle Name".
  if (raw.includes(',')) {
    const [last, rest = ''] = raw.split(',').map((s) => s.trim());
    const [first, ...mid] = rest.split(/\s+/).filter(Boolean);
    return { firstName: first ?? '', middleName: mid.join(' '), lastName: last ?? '' };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts[parts.length - 1] };
}

function extractFieldsFromPage(
  text: string,
  words: Tesseract.Word[],
  fields: Partial<Record<IptrOcrFieldKey, string>>,
  confidences: Partial<Record<IptrOcrFieldKey, number>>,
) {
  // Only fills fields the previous page(s) didn't find — earlier pages win.
  const setField = (key: IptrOcrFieldKey, rawValue: string | null, normalize?: (v: string) => string) => {
    if (fields[key] || !rawValue) return;
    const value = normalize ? normalize(rawValue) : rawValue;
    if (!value) return;
    fields[key] = value;
    const conf = confidenceForValue(rawValue, words);
    if (conf !== undefined) confidences[key] = Math.round(conf);
  };

  const nameRaw = findLabelValue(text, ['name', "student'?s name", 'pangalan']);
  if (nameRaw && !fields.firstName && !fields.lastName) {
    const { firstName, middleName, lastName } = splitName(nameRaw);
    setField('firstName', firstName);
    setField('middleName', middleName);
    setField('lastName', lastName);
    // Split fields inherit the whole-name-line confidence since OCR reports it per word, not per split.
    const conf = confidenceForValue(nameRaw, words);
    if (conf !== undefined) {
      if (fields.firstName) confidences.firstName = Math.round(conf);
      if (fields.middleName) confidences.middleName = Math.round(conf);
      if (fields.lastName) confidences.lastName = Math.round(conf);
    }
  }

  setField('birthdate', findLabelValue(text, ['birth\\s*date', 'birthday', 'date of birth']), normalizeBirthdate);
  setField('age', findLabelValue(text, ['age']));
  setField('gender', findLabelValue(text, ['sex', 'gender']), normalizeSex);
  setField('address', findLabelValue(text, ['address']), normalizeAddress);
  setField('contactNumber', findLabelValue(text, ['contact\\s*(no\\.?|number|#)', 'mobile\\s*(no\\.?|number|#)']));
  // The form prints the whole caption "Philhealth #: Principal / Dependent:"
  // before the blank, so Principal/Dependent is consumed as PART OF THE LABEL.
  // Without that the capture starts at "Principal" and the number is lost.
  setField(
    'philhealthNumber',
    findLabelValue(text, ['phil\\s*health\\s*(?:#|no\\.?|number)?\\s*:?\\s*(?:principal\\s*[\\/|]?\\s*dependent)?']),
    normalizePhilhealth,
  );
  setField('fourPsId', findLabelValue(text, ['4\\s*ps\\s*[\\/|]?\\s*nhts', '4\\s*ps']), normalizeFourPs);
}

function wordsOf(data: Tesseract.Page): Tesseract.Word[] {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}

// ── Orientation ────────────────────────────────────────────────────────────
// The supplied IPTR scan stores page 2 UPSIDE DOWN, and `pdfinfo` reports
// `Page rot: 0` for both pages — the rotation is baked into the scanned image,
// so no metadata will ever reveal it. OCR on an inverted page does not error;
// it returns almost nothing, which used to look exactly like "this page had no
// fields on it". A phone photo of a form held the wrong way round does the
// same thing.
//
// ⚠ THIS IS A SAFETY FIX, NOT A CONVENIENCE. The checkbox grid reader
// (iptrCheckboxes.ts) identifies a row BY POSITION — the nth band is the nth
// form row. On a 180°-rotated page the bands come back in reverse order, so
// the grid could be read "successfully" and attribute every tick to the wrong
// condition. Feeding it the orientation-corrected canvas is what prevents
// that; declining, which is its only other defence, would not have caught it.
// ⚠ WORD COUNT IS THE WRONG SIGNAL, and measuring said so. On the real IPTR
// page 1 flipped 180°, Tesseract returned MORE words than upright (423 vs
// 401) — it happily reads inverted glyphs as other letters. What collapses is
// their QUALITY: mean confidence 36 vs 69, and strong words (≥75% confident,
// ≥3 characters) 22 vs 180. So the trigger is quality, and the decision
// between the two orientations is the strong-word count.
const STRONG_CONFIDENCE = 75;

function alnumWords(words: Tesseract.Word[]): Tesseract.Word[] {
  return words.filter((w) => /[a-z0-9]/i.test(w.text));
}

/** Strong words — the score the two orientations are compared on. */
function pageScore(words: Tesseract.Word[]): number {
  return alnumWords(words).filter(
    (w) => w.confidence >= STRONG_CONFIDENCE && w.text.replace(/[^a-z0-9]/gi, '').length >= 3,
  ).length;
}

function meanConfidence(words: Tesseract.Word[]): number {
  const ws = alnumWords(words);
  return ws.length ? ws.reduce((sum, w) => sum + w.confidence, 0) / ws.length : 0;
}

/** Retry thresholds. Deliberately generous: a needless retry costs a few
 *  seconds and NEVER costs accuracy, because the better-scoring orientation is
 *  the one kept. Page 2 is mostly an odontogram and legitimately sparse, which
 *  is why a low score alone triggers a retry rather than a verdict. */
const RETRY_BELOW_MEAN = 55;
const RETRY_BELOW_SCORE = 8;

async function rotate180(image: Tesseract.ImageLike): Promise<HTMLCanvasElement | null> {
  const source = await toCanvas(image);
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(source.width, source.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

interface RecognizedPage {
  text: string;
  words: Tesseract.Word[];
  /** The image in the orientation that actually read — hand THIS to the grid
   *  reader, not the original. */
  image: Tesseract.ImageLike;
  rotated: boolean;
}

async function recognizePage(worker: Tesseract.Worker, image: Tesseract.ImageLike): Promise<RecognizedPage> {
  const first = await worker.recognize(image, {}, { blocks: true });
  const firstWords = wordsOf(first.data);
  const upright: RecognizedPage = { text: first.data.text, words: firstWords, image, rotated: false };
  if (meanConfidence(firstWords) >= RETRY_BELOW_MEAN && pageScore(firstWords) >= RETRY_BELOW_SCORE) return upright;

  const flipped = await rotate180(image);
  if (!flipped) return upright; // e.g. a PDF page we could not re-canvas — keep what we have.
  const second = await worker.recognize(flipped, {}, { blocks: true });
  const secondWords = wordsOf(second.data);
  return pageScore(secondWords) > pageScore(firstWords)
    ? { text: second.data.text, words: secondWords, image: flipped, rotated: true }
    : upright;
}

export async function extractIptrFields(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<IptrOcrResult> {
  const images: Tesseract.ImageLike[] = file.type === 'application/pdf'
    ? await rasterizePdfPages(file)
    : [file];

  let pageIndex = 0;

  const worker = await Tesseract.createWorker('eng', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        // Split progress evenly across pages so multi-page PDFs still show smooth 0-100%.
        onProgress(Math.round((pageIndex + m.progress) / images.length * 100));
      }
    },
  });

  const fields: Partial<Record<IptrOcrFieldKey, string>> = {};
  const confidences: Partial<Record<IptrOcrFieldKey, number>> = {};
  const rawTextParts: string[] = [];
  const allWords: Tesseract.Word[] = [];

  // Page 1 in whatever orientation actually read — see recognizePage.
  let firstPageImage: Tesseract.ImageLike | null = null;

  try {
    for (; pageIndex < images.length; pageIndex++) {
      const page = await recognizePage(worker, images[pageIndex]);
      if (pageIndex === 0) firstPageImage = page.image;
      allWords.push(...page.words);
      rawTextParts.push(page.text);
      extractFieldsFromPage(page.text, page.words, fields, confidences);
    }
  } finally {
    await worker.terminate();
  }

  const overallConfidence = allWords.length
    ? Math.round(allWords.reduce((sum, w) => sum + w.confidence, 0) / allWords.length)
    : 0;

  // ── The Year 1-5 tick grid (page 1 only) ─────────────────────────────────
  // Read WITHOUT OCR — see iptrCheckboxes.ts. Runs on the first page because
  // that is where the table is printed; page 2 is the odontogram.
  let checkboxes: IptrCheckboxFinding[] = [];
  let checkboxConfidence = 0;
  let checkboxReason: string | undefined;
  const unstorable = new Set<string>();
  try {
    // ⚠ The ORIENTATION-CORRECTED page 1, never the raw upload. Row identity
    // in the grid reader is positional, so an upside-down page would map ticks
    // onto the wrong conditions instead of failing.
    const page1 = await toCanvas(firstPageImage ?? images[0]);
    const scan = page1
      ? readIptrCheckboxes(page1)
      : { ticks: {}, confidence: 0, reason: 'Could not rasterise the first page.' };
    checkboxConfidence = scan.confidence;
    checkboxReason = scan.reason;
    if (scan.confidence > 0) {
      checkboxes = IPTR_FORM_ROWS.map((row, i) => {
        const years = IPTR_YEARS.filter((y) => scan.ticks[y]?.[i]);
        return { label: row.label, section: row.section, field: row.field, years: [...years] };
      }).filter((f) => f.years.length > 0);
      for (const f of checkboxes) if (f.field === null) unstorable.add(f.label);
    }
  } catch (err) {
    // A failure here must never lose the identity fields the text pass already
    // read — the grid is an addition, not a precondition.
    checkboxReason = err instanceof Error ? err.message : 'Checkbox grid could not be read.';
  }

  return {
    fields,
    confidences,
    rawText: rawTextParts.join('\n\n--- page break ---\n\n'),
    overallConfidence,
    checkboxes,
    checkboxConfidence,
    checkboxReason,
    unstorableFindings: [...unstorable],
  };
}

/** Tesseract accepts several image types; the grid reader needs real pixels.
 *  A canvas comes through untouched, anything else is drawn into one. */
async function toCanvas(image: Tesseract.ImageLike): Promise<HTMLCanvasElement | null> {
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return image;
  if (typeof File !== 'undefined' && image instanceof File) {
    if (!image.type.startsWith('image/')) return null;
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }
  return null;
}
