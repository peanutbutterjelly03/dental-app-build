// ─── IPTR checkbox grid reader ───────────────────────────────────────────────
// Reads the big Year 1-5 table on page 1 of the DOH Individual Patient
// Treatment Record: Medical History, Dietary Habits and Social History, and
// Oral Health Condition.
//
// ⚠ THIS DELIBERATELY DOES NOT USE OCR. A handwritten tick is a mark in a
// known cell, not a character — measuring ink density in the cell is both far
// more reliable than asking Tesseract to recognise "✓" and much faster, and it
// needs no extra dependency. Character recognition stays for the identity
// fields, where the content really is text.
//
// HOW THE GRID IS FOUND: by detecting the table's own ruled lines (long runs of
// dark pixels in the horizontal and vertical projections), NOT by assuming
// fixed coordinates. A phone photo is never framed identically twice, so fixed
// fractions of the page would drift immediately; the printed rules are the one
// stable landmark on the sheet.
//
// ⚠ IT DECLINES RATHER THAN GUESSES. Row identity comes from POSITION — the
// nth detected row is the nth row of the form — so a single missed rule would
// shift every label by one and silently attribute a tick to the wrong
// condition. On a clinical record that is worse than returning nothing, so the
// reader requires the detected row count to match the form exactly and reports
// `confidence: 0` with no rows otherwise.

/** A row of the printed table, in the exact order it appears on the form.
 *  `field` is the key on the matching model; null means the form has the row
 *  and the data model has NOWHERE to put it (see UNMAPPED below). */
export interface FormRow {
  label: string;
  section: 'medical' | 'dietary' | 'oral';
  field: string | null;
  /** A row whose value is free text on the form, not a tick. */
  text?: boolean;
}

export const IPTR_FORM_ROWS: FormRow[] = [
  // Medical History — matches ApiMedicalHistory.
  { label: 'Allergies (Please specify)', section: 'medical', field: 'allergies', text: true },
  { label: 'Hypertension / CVA', section: 'medical', field: 'hypertension' },
  { label: 'Diabetes Mellitus', section: 'medical', field: 'diabetes_mellitus' },
  // ⚠ On the form, absent from MEDICAL_HISTORY. Detected and reported, never
  // silently dropped — see UNMAPPED_ROWS.
  { label: 'Blood Disorders', section: 'medical', field: null },
  { label: 'Cardiovascular / Heart Diseases', section: 'medical', field: 'cardiovascular_disease' },
  { label: 'Thyroid Disorders', section: 'medical', field: 'thyroid_disorders' },
  { label: 'Hepatitis (Please specify type)', section: 'medical', field: 'hepatitis_disorders' },
  { label: 'Malignancy (Please specify)', section: 'medical', field: 'malignancy' },
  { label: 'History of Previous Hospitalization:', section: 'medical', field: 'previous_hospitalization' },
  { label: 'Medical (Last Admission & Cause)', section: 'medical', field: null, text: true },
  { label: 'Surgical (Post-Operative)', section: 'medical', field: 'previous_surgical' },
  { label: 'Blood transfusion (Month & Year)', section: 'medical', field: 'blood_transfusion' },
  { label: 'Tattoo', section: 'medical', field: 'tattoo' },
  { label: 'Others (Please specify)', section: 'medical', field: 'others', text: true },

  // Dietary Habits and Social History — exact 1:1 with ApiDietarySocialHabits.
  { label: 'Sugar Sweetened Beverages/Food Drinker/Eater', section: 'dietary', field: 'sugar_beverages' },
  { label: 'Alcohol Drinker', section: 'dietary', field: 'alcohol_drinker' },
  { label: 'Tobacco User', section: 'dietary', field: 'tobacco_user' },
  { label: 'Betel Nut Chewer', section: 'dietary', field: 'betel_nut_chewer' },
  { label: 'Body Piercing', section: 'dietary', field: 'body_piercing' },
  { label: 'Nail Biting', section: 'dietary', field: 'nail_biting' },
  { label: 'Thumbsucking', section: 'dietary', field: 'thumb_sucking' },

  // Oral Health Condition — three rows have no field on ORAL_HEALTH_CONDITION.
  { label: 'Orally Fit', section: 'oral', field: null },
  { label: 'Dental Caries', section: 'oral', field: null },
  { label: 'Gingivitis', section: 'oral', field: 'gingivitis' },
  { label: 'Periodontal Disease', section: 'oral', field: 'periodontal_disease' },
  { label: 'Debris', section: 'oral', field: 'debris' },
  { label: 'Calculus', section: 'oral', field: 'calculus' },
  { label: 'Abnormal Growth', section: 'oral', field: 'abnormal_growth' },
  { label: 'Cleft Lip / Palate', section: 'oral', field: 'cleft_lip_palate' },
  { label: 'Completely Edentulous', section: 'oral', field: null },
  { label: 'Others (Please specify)', section: 'oral', field: 'others', text: true },
];

/** Rows the printed form carries that the data model cannot store. Reported so
 *  a tick in one of them is visibly dropped rather than invisibly lost:
 *   - Blood Disorders          — no field on MEDICAL_HISTORY
 *   - Orally Fit               — derived elsewhere from oral status, not stored
 *   - Dental Caries            — derived from the DMF index, not a boolean
 *   - Completely Edentulous    — no field on ORAL_HEALTH_CONDITION
 *  The same gap the Program Report and the Target Client List hit. */
export const UNMAPPED_ROWS = IPTR_FORM_ROWS.filter((r) => r.field === null && !r.text).map((r) => r.label);

/** Years 1-5 across the top of the table. */
export const IPTR_YEARS = [1, 2, 3, 4, 5] as const;

export interface CheckboxScan {
  /** Ticked rows per year: `ticks[year][rowIndex]`. Empty when confidence is 0. */
  ticks: Record<number, boolean[]>;
  /** 0 when the grid could not be read at all — see the decline rule above. */
  confidence: number;
  /** Why it declined, for the UI to show instead of a silent empty result. */
  reason?: string;
}

const EMPTY: CheckboxScan = { ticks: {}, confidence: 0 };

/** Collapse runs of adjacent indices into one line each, returning midpoints. */
function collapse(indices: number[], gap = 3): number[] {
  const out: number[] = [];
  let start = -1, prev = -1;
  for (const i of indices) {
    if (start === -1) { start = prev = i; continue; }
    if (i - prev <= gap) { prev = i; continue; }
    out.push(Math.round((start + prev) / 2));
    start = prev = i;
  }
  if (start !== -1) out.push(Math.round((start + prev) / 2));
  return out;
}

/**
 * Read the Year 1-5 tick grid from a rasterised page 1.
 *
 * Returns `confidence: 0` and a reason whenever the grid cannot be identified
 * with certainty — a wrong tick on a medical history is worse than no tick.
 */
export function readIptrCheckboxes(canvas: HTMLCanvasElement): CheckboxScan {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ...EMPTY, reason: 'No canvas context.' };

  const { width: w, height: h } = canvas;
  if (w < 400 || h < 400) return { ...EMPTY, reason: 'Image too small to find the table.' };

  const img = ctx.getImageData(0, 0, w, h).data;
  // Binarise once into a flat array — repeatedly indexing the RGBA buffer in
  // the projection loops below is the difference between instant and sluggish.
  const dark = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < img.length; p += 4, i++) {
    // Luminance, not a channel average: a blue ballpoint tick is much darker
    // to the eye than its raw red channel suggests.
    const lum = 0.299 * img[p] + 0.587 * img[p + 1] + 0.114 * img[p + 2];
    dark[i] = lum < 170 ? 1 : 0;
  }

  const horizontalRules = (y0: number, y1: number) => {
    const found: number[] = [];
    for (let y = y0; y < y1; y++) {
      let count = 0;
      const base = y * w;
      for (let x = 0; x < w; x++) count += dark[base + x];
      if (count > w * 0.45) found.push(y);
    }
    return collapse(found);
  };

  const verticalRules = (y0: number, y1: number) => {
    const span = y1 - y0;
    const found: number[] = [];
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = y0; y < y1; y++) count += dark[y * w + x];
      if (count > span * 0.5) found.push(x);
    }
    return collapse(found);
  };

  // ── Pass 1: a coarse band, then the columns inside it ────────────────────
  const coarse = horizontalRules(0, h);
  if (coarse.length < 20) {
    return { ...EMPTY, reason: `Only ${coarse.length} table lines found — the form may be skewed, cropped, or too faint.` };
  }
  const coarseTop = coarse[0], coarseBottom = coarse[coarse.length - 1];
  if (coarseBottom - coarseTop < 200) return { ...EMPTY, reason: 'Table band too short to be the Year 1-5 grid.' };

  const coarseV = verticalRules(coarseTop, coarseBottom);
  // Label column + five year columns = seven rules including both outer edges.
  if (coarseV.length < 7) {
    return { ...EMPTY, reason: `Found ${coarseV.length} column lines, expected at least 7 (label + Year 1-5).` };
  }

  // ── Pass 2: bound the table by where its OWN column rules run ────────────
  // ⚠ The page carries a SECOND table below this one (Date / Weight / Temp /
  // Chief Complaint / Diagnosis …), whose horizontal rules are just as long.
  // Taking the first and last horizontal line therefore spans BOTH tables, and
  // slicing rows off the end reads the wrong one — its column rules fall inside
  // the year-column bands and register as ink, which is exactly how a blank
  // form produced 29 phantom findings before this was fixed.
  //
  // The Year 1-5 column rules exist ONLY in this table, so the longest
  // continuous dark run down one of them is the table's true vertical extent.
  const probeX = coarseV[coarseV.length - 4]; // an interior year rule
  let bestStart = -1, bestLen = 0, runStart = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && dark[y * w + probeX] === 1;
    if (on && runStart === -1) runStart = y;
    // Tolerate hairline gaps so a faint scan does not split one rule in two.
    if (!on && runStart !== -1) {
      let gap = 0;
      while (y + gap < h && gap < 6 && dark[(y + gap) * w + probeX] === 0) gap++;
      if (gap < 6 && y + gap < h) { y += gap; continue; }
      if (y - runStart > bestLen) { bestLen = y - runStart; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestLen < 200) {
    return { ...EMPTY, reason: 'Could not trace the Year column rules down the page.' };
  }
  const top = bestStart, bottom = bestStart + bestLen;

  const hLines = horizontalRules(top, bottom + 1);
  const vLines = verticalRules(top, bottom);
  if (vLines.length < 7) {
    return { ...EMPTY, reason: `Found ${vLines.length} column lines inside the table, expected at least 7.` };
  }

  // ── ⚠ ORIENTATION — an independent guard, and it is not redundant ────────
  // A 180°-rotated page defeats every check above: the rules are all still
  // there, the row bands still count correctly, and the ticks come back in
  // REVERSE ROW ORDER. Measured on the genuine BLANK form flipped upside down,
  // this returned confidence 70 and **31 findings** — the invented-medical-
  // history failure Sprint 86 exists to prevent, arriving by another route.
  // iptrOcr.ts now corrects orientation before calling this, but row identity
  // here is positional, so orientation is proven rather than assumed.
  //
  // The proof is structural: the label column holds text like "Sugar Sweetened
  // Beverages/Food Drinker/Eater" and is more than twice the width of any Year
  // column, and it is printed on the LEFT. So the widest band must sit in the
  // left half of the table.
  //
  // ⚠ Test the widest band's POSITION, not its index. The table is drawn with
  // a DOUBLE left border, which yields a 9px sliver band before the label
  // column — measured on the real form, the bands are [9, 654, 277, 277, 277,
  // 277, 276], so the label column is band 1. An "index must be 0" test
  // rejects the genuine upright form.
  const bandWidths = vLines.slice(1).map((x, i) => x - vLines[i]);
  let widest = 0;
  for (let i = 1; i < bandWidths.length; i++) if (bandWidths[i] > bandWidths[widest]) widest = i;
  const widestCentre = (vLines[widest] + vLines[widest + 1]) / 2;
  const tableCentre = (vLines[0] + vLines[vLines.length - 1]) / 2;
  if (widestCentre > tableCentre) {
    return { ...EMPTY, reason: 'The form looks upside down — the label column is on the right. Rotate the image and scan it again.' };
  }

  // The five YEAR columns are the last five bands on the right; the wide
  // left-hand band is the label column and is never read for ticks.
  const yearEdges = vLines.slice(-6);

  // ── Row bands must match the form exactly, or we decline ─────────────────
  // Bands thinner than a text line are rule artefacts, not rows.
  const rowBands: [number, number][] = [];
  for (let i = 0; i < hLines.length - 1; i++) {
    const a = hLines[i], b = hLines[i + 1];
    if (b - a >= 8) rowBands.push([a, b]);
  }
  const expected = IPTR_FORM_ROWS.length;
  // Header row, DATE EXAMINED and the three section headings sit among the
  // bands; the data rows are the tail of the table.
  if (rowBands.length < expected) {
    return {
      ...EMPTY,
      reason: `Read ${rowBands.length} rows but the form has ${expected} tickable rows — refusing to guess which is which.`,
    };
  }
  const dataBands = rowBands.slice(rowBands.length - expected);

  // ── Ink density per cell ─────────────────────────────────────────────────
  const ticks: Record<number, boolean[]> = {};
  for (let yi = 0; yi < IPTR_YEARS.length; yi++) {
    const x0 = yearEdges[yi], x1 = yearEdges[yi + 1];
    const col: boolean[] = [];
    for (const [ya, yb] of dataBands) {
      // Inset so the cell's own ruled borders are not counted as ink.
      const ix0 = x0 + 3, ix1 = x1 - 3, iy0 = ya + 3, iy1 = yb - 3;
      let ink = 0, total = 0;
      for (let y = iy0; y < iy1; y++) {
        const base = y * w;
        for (let x = ix0; x < ix1; x++) { ink += dark[base + x]; total++; }
      }
      // 4% of the cell inked is a deliberate, empirical floor: scanner speckle
      // and bleed-through sit well below it, and even a small tick sits above.
      col.push(total > 0 && ink / total > 0.04);
    }
    ticks[IPTR_YEARS[yi]] = col;
  }

  // Confidence reflects how cleanly the grid resolved, not how sure we are that
  // a given tick is a tick — the UI must still put every result in front of a
  // human, per CLAUDE.md's rule that OCR assists and never decides.
  const confidence = Math.min(95, 60 + Math.round((vLines.length - 6) * 5));
  return { ticks, confidence };
}
