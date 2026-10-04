// Shared CSV/Excel parsing for anything that reads a student roster file --
// the Students page's bulk importer and the OCR "Scan Form" flow's
// spreadsheet path both read the same shape of file the same way (2026-09-29:
// pulled out of PatientList.tsx so ScanStudentForm.tsx isn't importing a
// "page" component just for its parsing helpers).
import { GRADES } from '../components/PromoteAssign';

// minimal CSV field splitter that honors double-quoted fields
export const parseCsvLine = (line: string): string[] => {
  const out: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};

// "Date of Birth (dd/mm//yyyy)" → "date_of_birth", "Middle Initial" →
// "middle_initial", "Contact #" → "contact". A note in brackets and any
// punctuation are dropped, so the clinic's own column captions match
// (2026-10-04: its encoded workbook matched nothing and every row came in blank).
export const normalizeHeader = (h: string) =>
  h.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Column names that identify a STUDENT roster header row. */
const KNOWN_HEADERS = new Set([
  'last_name', 'lastname', 'surname', 'first_name', 'firstname', 'given_name', 'middle_name', 'middle_initial',
  'full_name', 'birthday', 'birthdate', 'birth_date', 'date_of_birth', 'sex', 'gender', 'grade', 'grade_level',
  'section', 'address', 'contact_number', 'place_of_birth',
]);

/** The header row: of the first rows, the one naming the most known columns.
 *  The clinic's workbook puts group titles on row 1 ("Medical History", …)
 *  and the real column names on row 2, so "row 1 is the header" read nothing. */
export function findHeaderRow(rows: string[][], scan = 10): number {
  let best = 0, bestHits = 0;
  rows.slice(0, scan).forEach((cells, i) => {
    const hits = new Set(cells.map(normalizeHeader).filter((h) => KNOWN_HEADERS.has(h))).size;
    if (hits > bestHits) { best = i; bestHits = hits; }
  });
  return best;
}

/** A birthday as YYYY-MM-DD, or the raw text when it cannot be read safely.
 *  `dayFirst`: the column says dd/mm (the Philippine way), so 11/01/2019 is
 *  11 January. Without that hint a day above 12 still settles it. */
export function toIsoDate(raw: string, dayFirst: boolean): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return t;
  let [a, b] = [Number(m[1]), Number(m[2])];
  const dayIsFirst = dayFirst || a > 12;
  const [day, month] = dayIsFirst ? [a, b] : [b, a];
  if (month < 1 || month > 12 || day < 1 || day > 31) return t;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const normalizeSex = (s: string): string | null => {
  const t = s.trim().toLowerCase();
  if (t === 'm' || t === 'male') return 'Male';
  if (t === 'f' || t === 'female') return 'Female';
  return null;
};

export const normalizeGrade = (g: string): string | null => {
  const t = g.trim().toLowerCase();
  if (!t) return null;
  if (t === 'k' || t.startsWith('kinder')) return 'Kinder';
  const m = t.match(/(\d{1,2})/);
  if (m) {
    const cand = `Grade ${parseInt(m[1], 10)}`;
    return GRADES.includes(cand) ? cand : null;
  }
  return null;
};

/** Reads a .csv/.xlsx/.xls file into header-normalized records. Used both by
 *  the bulk importer (every row -> a BulkRow) and single-student OCR (only
 *  the first row matters). Dynamic-imports exceljs, same bundle-protection
 *  as exportToXlsx. */
export async function parseSpreadsheetRecords(file: File): Promise<Record<string, string>[]> {
  const records: Record<string, string>[] = [];
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('No worksheet found in the file.');
    // Find the real header row among the first rows (see findHeaderRow).
    const firstRows: string[][] = [];
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const cells: string[] = [];
      ws.getRow(r).eachCell((cell, col) => { cells[col] = String(cell.text ?? cell.value ?? ''); });
      firstRows.push(Array.from(cells, (c) => c ?? ''));
    }
    const headerRow = findHeaderRow(firstRows) + 1;
    const headers: string[] = [];
    const dayFirstCols = new Set<number>();
    ws.getRow(headerRow).eachCell((cell, col) => {
      const raw = String(cell.text ?? cell.value ?? '');
      headers[col] = normalizeHeader(raw);
      if (/dd\s*\/\s*mm/i.test(raw)) dayFirstCols.add(col);
    });
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const rec: Record<string, string> = {};
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (!key) return;
        let value: string;
        if (cell.value instanceof Date) {
          // Excel stores a date cell as midnight UTC: read it in UTC or the
          // Philippine offset can move it to the day before.
          const d = cell.value;
          value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        } else {
          value = (cell.text ? String(cell.text) : String(cell.value ?? '')).trim();
          if (dayFirstCols.has(col)) value = toIsoDate(value, true);
        }
        // Two columns with the same name (the workbook repeats Date of Birth):
        // the first one with a value wins.
        if (value && !rec[key]) rec[key] = value;
      });
      if (Object.values(rec).some((v) => v)) records.push(rec);
    });
  } else {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('The file has a header but no data rows.');
    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    for (const line of lines.slice(1)) {
      const vals = parseCsvLine(line);
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => { rec[h] = vals[i] ?? ''; });
      records.push(rec);
    }
  }
  if (records.length === 0) throw new Error('No data rows found in the file.');
  return records;
}
