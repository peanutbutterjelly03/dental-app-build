import { downloadBlob } from './exportCsv';

// The DOH Consolidated Report is a 77-column cross-tab that never fit a PDF
// page legibly. Excel is its natural home: a real .xlsx with a frozen
// Indicator column + header rows, and print titles so Excel bands the columns
// across printed pages by itself. exceljs (~1MB) is dynamic-imported so only
// users who click "Download Excel" pull it in (same pattern as exportXlsx.ts,
// and it stays out of the SW precache via globIgnores '**/exceljs*.js').

export interface DohRowDef {
  type: 'header' | 'data' | 'sub';
  label: string;
  field?: string;
  indent?: boolean;
}

export interface DohXlsxParams {
  grades: string[];
  gradeBrackets: Record<string, { label: string; ages: string[] }>;
  summaryBrackets: string[];
  rows: DohRowDef[];
  // Single source of truth — the same accessor the on-screen table uses.
  getCell: (grade: string, age: string, sex: 'M' | 'F', field: string) => number;
  school: string;
  monthYear: string;
  filename: string;
}

// exceljs ships no exported Cell type we can name without importing it eagerly;
// a thin local alias keeps the styling code readable without pulling types in.
type XlsxCell = {
  value: string | number;
  font?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  border?: Record<string, unknown>;
};

const GRADE_FILL = 'FFDBEAFE'; // blue-100
const SUMMARY_FILL = 'FFEDE9FE'; // purple-100
const SECTION_FILL = 'FFEFF6FF'; // blue-50
const GRID = 'FFE5E7EB'; // gray-200

// Blank on zero (matches the on-screen `cell()` helper) so the sheet reads clean.
function setNum(cell: XlsxCell, v: number, bold = false) {
  cell.value = v === 0 ? '' : v;
  cell.alignment = { horizontal: 'center' };
  cell.font = { size: 9, ...(bold ? { bold: true } : {}) };
}

export async function exportDohReportToXlsx(params: DohXlsxParams): Promise<void> {
  const { grades, gradeBrackets, summaryBrackets, rows, getCell, school, monthYear, filename } = params;

  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DOH Consolidated');

  // Column geometry: col 1 = Indicator. Per grade: ages*2 (M/F) + 2 (grade
  // Total M/F). Then summary: brackets*2.
  const gradeSpan = (g: string) => gradeBrackets[g].ages.length * 2 + 2;
  const totalDataCols = grades.reduce((s, g) => s + gradeSpan(g), 0) + summaryBrackets.length * 2;
  const lastCol = 1 + totalDataCols;

  // Aggregations — identical formulas to the on-screen table (Reports.tsx).
  const gradeTotal = (g: string, sex: 'M' | 'F', field: string) =>
    gradeBrackets[g].ages.reduce((s, a) => s + getCell(g, a, sex, field), 0);
  const summaryTotal = (bracket: string, sex: 'M' | 'F', field: string) =>
    grades.reduce((s, g) => (gradeBrackets[g].ages.includes(bracket) ? s + getCell(g, bracket, sex, field) : s), 0);

  // ── Row 1: title ──
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1) as unknown as XlsxCell;
  titleCell.value = 'DENTAL SECTION — CONSOLIDATED ORAL HEALTH STATUS AND SERVICE REPORT';
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center' };

  // ── Row 2: subtitle ──
  sheet.mergeCells(2, 1, 2, lastCol);
  const subCell = sheet.getCell(2, 1) as unknown as XlsxCell;
  subCell.value = `SCHOOL: ${school}      MONTH: ${monthYear}`;
  subCell.alignment = { horizontal: 'center' };
  subCell.font = { size: 10, color: { argb: 'FF6B7280' } };

  // ── Rows 3-5: 3-tier header. Indicator label spans all three in col 1. ──
  sheet.mergeCells(3, 1, 5, 1);
  const indCell = sheet.getCell(3, 1) as unknown as XlsxCell;
  indCell.value = 'Indicator';
  indCell.font = { bold: true };
  indCell.alignment = { horizontal: 'left', vertical: 'middle' };

  let col = 2;
  for (const g of grades) {
    const span = gradeSpan(g);
    // Row 3: grade label merged across its whole span.
    sheet.mergeCells(3, col, 3, col + span - 1);
    const gc = sheet.getCell(3, col) as unknown as XlsxCell;
    gc.value = gradeBrackets[g].label;
    gc.font = { bold: true, color: { argb: 'FF1E40AF' } };
    gc.alignment = { horizontal: 'center' };
    gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRADE_FILL } };

    // Rows 4 (age bracket, merged over M/F) + 5 (M/F).
    let c = col;
    for (const a of gradeBrackets[g].ages) {
      sheet.mergeCells(4, c, 4, c + 1);
      const ac = sheet.getCell(4, c) as unknown as XlsxCell;
      ac.value = a;
      ac.alignment = { horizontal: 'center' };
      ac.font = { size: 8 };
      (sheet.getCell(5, c) as unknown as XlsxCell).value = 'M';
      (sheet.getCell(5, c + 1) as unknown as XlsxCell).value = 'F';
      c += 2;
    }
    // Grade Total (M/F).
    sheet.mergeCells(4, c, 4, c + 1);
    const tc = sheet.getCell(4, c) as unknown as XlsxCell;
    tc.value = 'Total';
    tc.font = { bold: true, color: { argb: 'FF1D4ED8' } };
    tc.alignment = { horizontal: 'center' };
    (sheet.getCell(5, c) as unknown as XlsxCell).value = 'M';
    (sheet.getCell(5, c + 1) as unknown as XlsxCell).value = 'F';
    col += span;
  }

  // SUMMARY block header (row 3) + brackets (row 4) + M/F (row 5).
  sheet.mergeCells(3, col, 3, col + summaryBrackets.length * 2 - 1);
  const sc = sheet.getCell(3, col) as unknown as XlsxCell;
  sc.value = 'SUMMARY';
  sc.font = { bold: true, color: { argb: 'FF6D28D9' } };
  sc.alignment = { horizontal: 'center' };
  sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_FILL } };
  let scol = col;
  for (const b of summaryBrackets) {
    sheet.mergeCells(4, scol, 4, scol + 1);
    const bc = sheet.getCell(4, scol) as unknown as XlsxCell;
    bc.value = b;
    bc.font = { size: 8 };
    bc.alignment = { horizontal: 'center' };
    (sheet.getCell(5, scol) as unknown as XlsxCell).value = 'M';
    (sheet.getCell(5, scol + 1) as unknown as XlsxCell).value = 'F';
    scol += 2;
  }

  // Style the M/F row uniformly.
  for (let cc = 2; cc <= lastCol; cc++) {
    const mf = sheet.getCell(5, cc) as unknown as XlsxCell;
    mf.alignment = { horizontal: 'center' };
    mf.font = { size: 8, bold: true };
  }

  // ── Data rows ──
  let r = 6;
  for (const row of rows) {
    if (row.type === 'header') {
      sheet.mergeCells(r, 1, r, lastCol);
      const hc = sheet.getCell(r, 1) as unknown as XlsxCell;
      hc.value = row.label;
      hc.font = { bold: true, color: { argb: 'FF1E3A8A' } };
      hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
      r++;
      continue;
    }

    const field = row.field ?? '';
    const labelCell = sheet.getCell(r, 1) as unknown as XlsxCell;
    // Indent sub/indented rows via leading spaces (Excel has no cheap CSS pad).
    labelCell.value = (row.type === 'sub' ? '        ' : row.indent ? '    ' : '') + row.label;
    if (row.type === 'sub') labelCell.font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };
    else if (!row.indent) labelCell.font = { bold: true, size: 9 };
    else labelCell.font = { size: 9 };

    let cc = 2;
    for (const g of grades) {
      for (const a of gradeBrackets[g].ages) {
        setNum(sheet.getCell(r, cc) as unknown as XlsxCell, getCell(g, a, 'M', field));
        setNum(sheet.getCell(r, cc + 1) as unknown as XlsxCell, getCell(g, a, 'F', field));
        cc += 2;
      }
      setNum(sheet.getCell(r, cc) as unknown as XlsxCell, gradeTotal(g, 'M', field), true);
      setNum(sheet.getCell(r, cc + 1) as unknown as XlsxCell, gradeTotal(g, 'F', field), true);
      cc += 2;
    }
    for (const b of summaryBrackets) {
      setNum(sheet.getCell(r, cc) as unknown as XlsxCell, summaryTotal(b, 'M', field));
      setNum(sheet.getCell(r, cc + 1) as unknown as XlsxCell, summaryTotal(b, 'F', field));
      cc += 2;
    }
    r++;
  }
  const lastRow = r - 1;

  // ── Column widths ── Indicator wide, data columns narrow (M/F single digits).
  sheet.getColumn(1).width = 42;
  for (let cc = 2; cc <= lastCol; cc++) sheet.getColumn(cc).width = 5;

  // ── Thin grid on the header + data block ──
  for (let rr = 3; rr <= lastRow; rr++) {
    for (let cc = 1; cc <= lastCol; cc++) {
      (sheet.getCell(rr, cc) as unknown as XlsxCell).border = {
        top: { style: 'thin', color: { argb: GRID } },
        left: { style: 'thin', color: { argb: GRID } },
        bottom: { style: 'thin', color: { argb: GRID } },
        right: { style: 'thin', color: { argb: GRID } },
      };
    }
  }

  // ── Freeze Indicator col + all header rows; print setup so Excel bands the
  //    columns across pages and repeats the Indicator col + headers. ──
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 5 }];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: false,
    printTitlesColumn: 'A:A',
    printTitlesRow: '1:5',
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}
