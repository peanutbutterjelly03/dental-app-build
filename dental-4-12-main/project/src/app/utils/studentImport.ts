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

export const normalizeHeader = (h: string) => h.toLowerCase().trim().replace(/\s+/g, '_');

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
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => { headers[col] = normalizeHeader(String(cell.value ?? '')); });
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, string> = {};
      row.eachCell((cell, col) => {
        if (headers[col]) rec[headers[col]] = (cell.text ? String(cell.text) : String(cell.value ?? '')).trim();
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
