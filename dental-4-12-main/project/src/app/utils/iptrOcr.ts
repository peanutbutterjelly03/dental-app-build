import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Threshold + types live in iptrOcrShared.ts so the UI can import them
// without dragging tesseract/pdfjs into the main bundle.
import type { IptrOcrFieldKey, IptrOcrResult, IptrCheckboxFinding } from './iptrOcrShared';
import { readIptrTickBoxes } from './iptrTickBoxes';
import { readIptrCheckboxes, IPTR_FORM_ROWS, IPTR_YEARS } from './iptrCheckboxes';
import { normalizeGrade } from './studentImport';
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
  // Separate name fields (2026-09-29: some encoded/re-typed forms print
  // Last Name/Surname, First Name and Middle Name as three distinct labels
  // rather than one combined "Name" line — see splitName's fallback below)
  // BEFORE the generic combined ones, so a stop-boundary check hits the
  // more specific label first.
  'last\\s*name', 'surname', 'apelyido',
  'first\\s*name', 'given\\s*name',
  'middle\\s*name', 'gitnang\\s*pangalan',
  "student'?s name", "patient'?s name", 'pangalan', 'name',
  'birth\\s*date', 'birthday', 'date\\s*of\\s*birth',
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
  // Both sides stripped the same way: words were, tokens were not, so a
  // dashed value ("0912-345-6789") never matched and lost its EXTRACTED badge.
  const tokens = value.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, '')).filter(Boolean);
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

// ⚠ Anything that is not plainly M/F is BLANK, never passed through (O2,
// 2026-10-01). "Sex *" followed by two checkboxes read as the value "*", which
// then filled the field and stopped the ink-density reader (iptrTickBoxes.ts)
// from ever deciding it: the ticked box was ignored because junk got there first.
function normalizeSex(raw: string): string {
  const t = raw.trim();
  if (/^m(ale)?$/i.test(t)) return 'Male';
  if (/^f(emale)?$/i.test(t)) return 'Female';
  // The IPTR prints "Sex: M ____ F ____" and the dentist ticks one blank. OCR
  // reads the tick as a glyph after its letter ("M Fv" = F ticked). Exactly one
  // letter must carry a mark; none or both is blank.
  const mf = t.match(/^M\s*[_\s]*([v✓√\/]?)\s*[_\s]*F\s*[_\s]*([v✓√\/]?)[_\s]*$/i);
  if (mf && !!mf[1] !== !!mf[2]) return mf[1] ? 'Male' : 'Female';
  return '';
}

// A phone number has digits. A form's greyed example ("09XX XXX XXXX") was read
// as the pupil's number on the web-form layout (O2, 2026-10-01); PH mobile
// numbers are 11 digits and landlines 7-8, so fewer than 7 is not a number.
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '').length >= 7 ? raw.trim() : '';
}

// The first real grade in the answer: a web form printed "Grade choices:
// Kinder, Grade 1, …" under the Grade box and it was read into the value.
function normalizeGradeText(raw: string): string {
  const m = raw.match(/\b(kinder(?:garten)?|grade\s*\d{1,2})\b/i);
  return m ? normalizeGrade(m[1]) ?? '' : '';
}

function normalizeAge(raw: string): string {
  return raw.trim().match(/^\d{1,2}\b/)?.[0] ?? '';
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function normalizeBirthdate(raw: string): string {
  // Handles MM/DD/YYYY, M-D-YYYY, and YYYY-MM-DD; returns YYYY-MM-DD for <input type="date">.
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const mdy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  // "January 11, 2019" (a form filled out in prose, not MM/DD/YYYY) -- month
  // and day matched TIGHT right after each other (real text on this form
  // reads "Month DD,"), the year searched for separately anywhere in the
  // raw value. Needed because a garbled duplicate OCR read of the same
  // handwritten line (e.g. a stray "11, 201" fragment ahead of the real
  // "January 11, 2019") can land between the day and the true year, which
  // a single combined regex would either swallow or reject outright.
  const monthDay = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b/i);
  const year = raw.match(/\b(19|20)\d{2}\b/);
  if (monthDay && year) {
    const month = MONTH_NAMES[monthDay[1].toLowerCase()];
    if (month) return `${year[0]}-${String(month).padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  }
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
  // A trailing initial ("Reyes Mikaela S.") means the IPTR's own column order,
  // Surname / First Name / M.I. (the captions printed under the line). Nobody
  // writes a SURNAME as one letter, so this cannot be "First Middle Last"
  // (O2, 2026-10-01: that reading made "Reyes" the first name).
  if (parts.length >= 3 && /^[A-Z]\.?$/i.test(parts[parts.length - 1])) {
    return { lastName: parts[0], firstName: parts.slice(1, -1).join(' '), middleName: parts[parts.length - 1].toUpperCase() };
  }
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts[parts.length - 1] };
}

// ── Grid/box-layout extraction ───────────────────────────────────────────────
// Added 2026-09-29 after the school's actual working form -- a "Patient
// Information Sheet" the clinic designed itself, not the official DOH IPTR
// -- turned out to be a BORDERED GRID: each field's caption ("Last Name *")
// sits in its own box, with the answer written on the line BELOW it, not
// beside it. The label-matching regex below this (findLabelValue) assumes
// flowing "Label: value" text on one line, which is what the official IPTR
// prints; it cannot represent "the value is the text in roughly this
// x-range on the next line down", so it read three side-by-side name boxes
// as one garbled blob and dropped or misattributed nearly every field.
//
// This extractor works on WORD POSITIONS instead of flattened text: it
// finds each known caption, then looks for its answer (a) as the remaining
// text on the SAME line after the caption (handles the DOH IPTR's inline
// style too), or failing that (b) as the words on the next line(s) whose
// x-range lines up with the caption's own column. Verified against a real
// scan of the actual form (not guessed): every personal-info field except
// the two checkbox ones below extracted correctly once y-band line
// clustering (next) was added.
//
// Checkboxes (Sex, PhilHealth Status) are NOT read from text here -- OCR can
// find the words "Male"/"Female" but not which box is ticked (a real capture
// read as "mete 7] Female"). They are read by ink density in iptrTickBoxes.ts,
// anchored to these same OCR'd label positions, and declined when ambiguous.
type GridWord = { text: string; x0: number; x1: number; y0: number; y1: number; confidence: number };
type GridLine = { x0: number; x1: number; y0: number; y1: number; words: GridWord[] };

/** Real field keys this extractor fills, plus boundary-only pseudo-keys
 *  (prefixed `__`) recognized ONLY to correctly bound neighboring columns --
 *  never written to `fields`. Order doesn't matter; every line is checked
 *  against all of them. */
const GRID_LABELS: [string, RegExp][] = [
  ['lastName', /^(?:last\s*name|surname|apelyido)\b/i],
  ['firstName', /^(?:first\s*name|given\s*name)\b/i],
  ['middleName', /^middle\s*name\b/i],
  ['birthdate', /^(?:birth\s*date|birthday)\b/i],
  ['__age__', /^age\b/i],
  ['__sex__', /^sex\b/i],
  ['grade', /^grade\b/i],
  ['section', /^section\b/i],
  ['placeOfBirth', /^place\s*of\s*birth\b/i],
  ['address', /^address\b/i],
  // `(?![a-z])`, not `\b`: `\b` never matches after "#" or "." when a colon
  // follows ("Contact #:"), so on the blank official IPTR these captions went
  // unrecognised and were read as ANSWERS ("Contact #:" as the occupation).
  ['contactNumber', /^contact\s*(?:no\.?|number|#)(?![a-z])/i],
  ['guardianOccupation', /^occupation\b/i],
  ['guardianName', /^guardian\s*name\b/i],
  ['guardianContact', /^guardian\s*contact\b/i],
  ['philhealthNumber', /^phil\s*health\s*(?:#|no\.?|number)(?![a-z])/i],
  ['__philhealthStatus__', /^phil\s*health\s*status\b/i],
  ['__signature__', /^(?:parent\s*\/\s*guardian|printed\s*name|date\s*of\s*form)\b/i],
  // The IPTR's "M.I." caption under the name line; OCR reads it as "ML".
  ['__mi__', /^(?:m\.?\s*i\.?|ml)$/i],
];

const GRID_NOISE_WORD = /^[*•·:\-]+$/;
// "(Optional)", and a caption's own "/Apelyido" alias half.
const GRID_SKIP_TEXT = /^(?:\(?optional\)?|\/\S*)$/i;
// Table rules OCR as | [ ]. An answer region containing them is a table row
// read across, not handwriting (the IPTR's ✓/X grid came back as an
// occupation, O2 2026-10-01), so the whole answer is dropped, not cleaned.
const GRID_TABLE_MARKS = /[[\]|]/;
const hasTableMarks = (words: GridWord[]) => words.some((w) => GRID_TABLE_MARKS.test(w.text));

/** Groups words into lines by Y-BAND OVERLAP rather than trusting Tesseract's
 *  own line segmentation, which was observed splitting one visual answer row
 *  into two overlapping "lines" on this form (a garbled partial re-read
 *  sitting right on top of the real text) -- merging by y-overlap recombines
 *  those without needing to know it happened. */
function gridLinesOf(words: Tesseract.Word[]): GridLine[] {
  const gw: GridWord[] = words
    .filter((w) => w.text.trim())
    .map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, confidence: w.confidence }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const bands: GridLine[] = [];
  for (const w of gw) {
    const band = bands.find((b) => w.y0 <= b.y1 && w.y1 >= b.y0);
    if (band) {
      band.words.push(w);
      band.y0 = Math.min(band.y0, w.y0);
      band.y1 = Math.max(band.y1, w.y1);
    } else {
      bands.push({ x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, words: [w] });
    }
  }
  for (const b of bands) {
    b.words.sort((a, c) => a.x0 - c.x0);
    b.x0 = Math.min(...b.words.map((w) => w.x0));
    b.x1 = Math.max(...b.words.map((w) => w.x1));
  }
  return bands.sort((a, b) => a.y0 - b.y0);
}

/** Caption matches found on one line: [x0 of first word, x1 of last word,
 *  field key, index of the last word consumed]. A line can carry several
 *  (e.g. "Last Name * First Name * Middle Name" is three). */
function gridCaptionsOn(line: GridLine): [number, number, string, number][] {
  const results: [number, number, string, number][] = [];
  const n = line.words.length;
  for (const [key, pattern] of GRID_LABELS) {
    for (let start = 0; start < n; start++) {
      let joined = '';
      for (let end = start; end < Math.min(start + 4, n); end++) {
        joined = `${joined} ${line.words[end].text}`.trim();
        if (pattern.test(joined)) {
          results.push([line.words[start].x0, line.words[end].x1, key, end]);
          break;
        }
      }
    }
  }
  return results;
}

/** Words Tesseract itself is this unsure of are dropped from answers (O2,
 *  2026-10-01). Measured on the clinic sheet: the tail of a handwritten "y"
 *  read as a separate word "TY" (confidence 26) sat between "January" and
 *  "11," and the date parser rejected "January TY 11, 2019", so the
 *  birthdate came back blank. Real answers on the same scans scored 81-96. */
const GRID_JUNK_CONFIDENCE = 40;

function gridClean(words: GridWord[]): GridWord[] {
  return words.filter((w) => !GRID_NOISE_WORD.test(w.text) && !GRID_SKIP_TEXT.test(w.text) && w.confidence >= GRID_JUNK_CONFIDENCE);
}

/** The extractor itself -- see the file comment above for what it does and
 *  why. Only ever ADDS fields it found; never overwrites one `setField`
 *  (the caller) already has. */
function extractGridFields(
  lines: GridLine[],
  setField: (key: IptrOcrFieldKey, rawValue: string | null, normalize?: (v: string) => string) => void,
  normalizers: Partial<Record<IptrOcrFieldKey, (v: string) => string>>,
) {
  const already = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const caps = gridCaptionsOn(line).sort((a, b) => a[0] - b[0]);
    if (!caps.length) continue;
    const siblingKeys = new Set(caps.map((c) => c[2]));
    for (let idx = 0; idx < caps.length; idx++) {
      const [cx0, cx1, key, ,] = caps[idx];
      if (key.startsWith('__') || already.has(key)) continue;
      const rightBound = idx + 1 < caps.length ? caps[idx + 1][0] - 8 : line.x1 + 100000;
      const leftBound = cx0 - 15;

      const restRaw = line.words.filter((w) => w.x0 >= cx1 + 3 && w.x0 < rightBound);
      const sameLineVal = hasTableMarks(restRaw) ? '' : gridClean(restRaw).map((w) => w.text).join(' ').trim();
      if (sameLineVal) {
        already.add(key);
        setField(key as IptrOcrFieldKey, sameLineVal, normalizers[key as IptrOcrFieldKey]);
        continue;
      }

      // Below-scan: the answer sometimes splits across 2 detected lines (see
      // the file comment), so collect from up to 2 lines below rather than
      // stopping at the first non-empty one. Stop only on a line that
      // introduces a DIFFERENT field's caption -- an answer legitimately
      // repeating ITS OWN caption word (a Grade value written as "Grade 1")
      // must not look like a stop signal.
      //
      // ⚠ Boundary-only captions (`__age__`, `__philhealthStatus__`, …) STOP
      // the scan too (O2, 2026-10-01): they exist precisely to bound their
      // neighbours, yet were filtered out here, which read "Sofia Age" as a
      // middle name and "Student PhilHealth Status" as an occupation. And a
      // second line is taken only when it sits right under the first: the
      // split-answer case is two touching lines, whereas a line a whole row
      // away is something else (a form footer was read into the address).
      const collected: GridWord[] = [];
      let prev: GridLine | null = null;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const below = lines[j];
        const otherCaps = gridCaptionsOn(below).filter((c) => !siblingKeys.has(c[2]));
        if (otherCaps.length) break;
        if (prev && below.y0 - prev.y1 > prev.y1 - prev.y0) break;
        const raw = below.words.filter((w) => w.x0 >= leftBound && w.x0 < rightBound);
        if (hasTableMarks(raw)) { collected.length = 0; break; }
        const words = gridClean(raw);
        collected.push(...words);
        if (words.length) prev = below;
      }
      const val = collected.map((w) => w.text).join(' ').trim();
      if (val) {
        already.add(key);
        setField(key as IptrOcrFieldKey, val, normalizers[key as IptrOcrFieldKey]);
      }
    }
  }
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

  // The IPTR prints its name captions UNDER the "Name:" line ("Surname/
  // Apelyido  First Name/Pangalan  M.I."). The grid reader and the separate
  // Last/First Name labels both assume a caption sits above or before its
  // answer, so on this layout they read the captions' neighbours as names
  // (O2, 2026-10-01: last name "/Apelyido", first name "ML"). Here the name
  // comes ONLY from the "Name:" line, split in the IPTR's column order.
  const iptrNameCaptions = /surname\s*\S?\s*apelyido/i.test(text);
  const NAME_KEYS: IptrOcrFieldKey[] = ['lastName', 'firstName', 'middleName'];
  const namesBefore = new Set(NAME_KEYS.filter((k) => fields[k]));

  // Grid/box-layout extraction FIRST (see the file comment on
  // extractGridFields) -- it's a superset of the flowing-text approach
  // below (handles same-line inline values too), so run it before falling
  // back to label-matching on flattened text for whatever it didn't find.
  extractGridFields(gridLinesOf(words), setField, {
    birthdate: normalizeBirthdate,
    address: normalizeAddress,
    gender: normalizeSex,
    philhealthNumber: normalizePhilhealth,
    contactNumber: normalizePhone,
    guardianContact: normalizePhone,
    grade: normalizeGradeText,
  });

  if (iptrNameCaptions) {
    for (const k of NAME_KEYS) if (!namesBefore.has(k)) { delete fields[k]; delete confidences[k]; }
    const nameRaw = findLabelValue(text, ['name']);
    if (nameRaw) {
      const split = splitName(nameRaw);
      setField('lastName', split.lastName);
      setField('firstName', split.firstName);
      setField('middleName', split.middleName);
    }
  }

  // Separate Last Name/Surname, First Name and Middle Name fields (2026-09-29:
  // "other term for last name is the surname... it doesn't place exactly
  // where it's needed") -- tried FIRST, before the combined single-line
  // "Name" fallback below. A form that prints these as three distinct
  // labels can't be read correctly by splitting one "Name:" value, and the
  // combined path never recognized "Surname" as an alias at all.
  if (!iptrNameCaptions) {
    setField('lastName', findLabelValue(text, ['last\\s*name', 'surname', 'apelyido']));
    setField('firstName', findLabelValue(text, ['first\\s*name', 'given\\s*name']));
    setField('middleName', findLabelValue(text, ['middle\\s*name', 'gitnang\\s*pangalan']));
  }

  // Combined "Last Name, First Name Middle Name" line -- the DOH IPTR's own
  // printed layout (see the file-level comment on ALL_FIELD_LABELS). Only
  // consulted for whichever of the three name parts the separate fields
  // above didn't already fill in.
  if (!fields.firstName || !fields.lastName) {
    const nameRaw = findLabelValue(text, ['name', "student'?s name", 'pangalan']);
    if (nameRaw) {
      const split = splitName(nameRaw);
      setField('firstName', split.firstName);
      setField('middleName', split.middleName);
      setField('lastName', split.lastName);
      // Split fields inherit the whole-name-line confidence since OCR reports it per word, not per split.
      const conf = confidenceForValue(nameRaw, words);
      if (conf !== undefined) {
        if (fields.firstName && confidences.firstName === undefined) confidences.firstName = Math.round(conf);
        if (fields.middleName && confidences.middleName === undefined) confidences.middleName = Math.round(conf);
        if (fields.lastName && confidences.lastName === undefined) confidences.lastName = Math.round(conf);
      }
    }
  }

  // `date\s*of\s*birth`: OCR ran the IPTR's caption together as "Dateof Birth".
  setField('birthdate', findLabelValue(text, ['birth\\s*date', 'birthday', 'date\\s*of\\s*birth']), normalizeBirthdate);
  setField('age', findLabelValue(text, ['age']), normalizeAge);
  setField('gender', findLabelValue(text, ['sex', 'gender']), normalizeSex);
  setField('address', findLabelValue(text, ['address']), normalizeAddress);
  setField('contactNumber', findLabelValue(text, ['contact\\s*(no\\.?|number|#)', 'mobile\\s*(no\\.?|number|#)']), normalizePhone);
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

/** The pure text rules, exported for iptrOcr.test.ts only. */
export const ocrTextRules = { normalizeSex, normalizePhone, normalizeGradeText, normalizeBirthdate, splitName, identityScore: (t: string) => identityScore(t) };

const IDENTITY_CAPTIONS = [
  /\bname\s*[:*]/i,
  /\b(?:last|first|middle)\s*name\b/i,
  /date\s*of\s*birth|birth\s*date|birthday/i,
  /\bsex\s*[:*]/i,
  /\baddress\b/i,
];

/** How many distinct identity captions a page prints (see the ranking in
 *  extractIptrFields). */
function identityScore(text: string): number {
  return IDENTITY_CAPTIONS.filter((re) => re.test(text)).length;
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
  const images: Tesseract.ImageLike[] = await splitSpreads(file.type === 'application/pdf'
    ? await rasterizePdfPages(file)
    : [file]);

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
  const recognized: RecognizedPage[] = [];

  try {
    for (; pageIndex < images.length; pageIndex++) {
      const page = await recognizePage(worker, images[pageIndex]);
      if (pageIndex === 0) firstPageImage = page.image;
      recognized.push(page);
      allWords.push(...page.words);
      rawTextParts.push(page.text);
    }
  } finally {
    await worker.terminate();
  }

  // Personal details come from the page(s) that CARRY them (O2, 2026-10-01).
  // Earlier pages used to win, so on a split two-page IPTR the medical-history
  // half went first and its signature line "Lagda at Pangalan ng Pasyente"
  // was read as the pupil's name. Pages are ranked by how many identity
  // captions they print; when any page has at least two, only such pages are
  // read, best first. With none (an unusual form), every page is read in order.
  const ranked = recognized
    .map((page, i) => ({ page, i, score: identityScore(page.text) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const fieldPages = ranked[0]?.score >= 2 ? ranked.filter((r) => r.score >= 2) : ranked.sort((a, b) => a.i - b.i);
  for (const { page } of fieldPages) extractFieldsFromPage(page.text, page.words, fields, confidences);

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
        return { label: row.label, section: row.section, field: row.field, text: !!row.text, years: [...years] };
      }).filter((f) => f.years.length > 0);
      for (const f of checkboxes) if (f.field === null) unstorable.add(f.label);
    }
  } catch (err) {
    // A failure here must never lose the identity fields the text pass already
    // read — the grid is an addition, not a precondition.
    checkboxReason = err instanceof Error ? err.message : 'Checkbox grid could not be read.';
  }

  // ── Sex + PhilHealth Status tick boxes (every page) ──────────────────────
  // Ink density beside the OCR'd option labels; see iptrTickBoxes.ts. Text
  // already read for a field wins; a failure here never loses other fields.
  // Every page, not page 1 only (O2, 2026-10-01): on a split two-page spread
  // the personal details are the RIGHT-hand page.
  for (const page of recognized) {
    if (fields.gender && fields.philhealthStatus) break;
    try {
      const canvas = await toCanvas(page.image);
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) continue;
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const labels = page.words.map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }));
      const ticks = readIptrTickBoxes(px, labels);
      if (ticks.gender && !fields.gender) {
        fields.gender = ticks.gender.value;
        confidences.gender = ticks.gender.confidence;
      }
      if (ticks.philhealthStatus && !fields.philhealthStatus) {
        fields.philhealthStatus = ticks.philhealthStatus.value;
        confidences.philhealthStatus = ticks.philhealthStatus.confidence;
      }
    } catch {
      // Left blank for the encoder to tick.
    }
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

// ── Two-page spreads ────────────────────────────────────────────────────────
// An IPTR printed or photographed as ONE landscape sheet (the medical history
// on the left, the treatment record on the right) is read by Tesseract straight
// across both halves, so "8. Ikaw ba ay nabunutan…" and "Jan 11, 2019 Age: 7"
// came out as one line and the name, birthdate and sex were lost (O2,
// 2026-10-01). Such a sheet is split at its blank middle gutter and each half
// read as its own page.
//
// ⚠ Split ONLY on a real gutter: a column near the middle with almost no ink
// from top to bottom. A single landscape photo of one portrait form has text
// crossing the middle, finds no gutter, and is left whole.
const SPREAD_MIN_ASPECT = 1.3;
const GUTTER_MAX_INK = 0.03;

async function splitSpreads(images: Tesseract.ImageLike[]): Promise<Tesseract.ImageLike[]> {
  const out: Tesseract.ImageLike[] = [];
  for (const image of images) {
    const canvas = await toCanvas(image);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width < canvas.height * SPREAD_MIN_ASPECT) { out.push(image); continue; }
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let bestX = -1;
    let bestInk = 1;
    for (let x = Math.round(canvas.width * 0.4); x <= Math.round(canvas.width * 0.6); x++) {
      let dark = 0;
      let rows = 0;
      for (let y = 0; y < canvas.height; y += 2) {
        const p = (y * canvas.width + x) * 4;
        if (0.299 * px.data[p] + 0.587 * px.data[p + 1] + 0.114 * px.data[p + 2] < 170) dark++;
        rows++;
      }
      if (dark / rows < bestInk) { bestInk = dark / rows; bestX = x; }
    }
    if (bestX < 0 || bestInk > GUTTER_MAX_INK) { out.push(image); continue; }
    for (const [sx, sw] of [[0, bestX], [bestX, canvas.width - bestX]]) {
      const half = document.createElement('canvas');
      half.width = sw;
      half.height = canvas.height;
      half.getContext('2d')?.drawImage(canvas, sx, 0, sw, canvas.height, 0, 0, sw, canvas.height);
      out.push(half);
    }
  }
  return out;
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
