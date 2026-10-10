// The DOH Consolidated Report is a 77-column cross-tab that never fit a PDF
// page legibly. Excel is its natural home: a real .xlsx with a frozen
// Indicator column + header rows, and print titles so Excel bands the columns
// across printed pages by itself. exceljs (~1MB) is dynamic-imported so only
// users who click "Download Excel" pull it in (same pattern as exportXlsx.ts,
// and it stays out of the SW precache via globIgnores '**/exceljs*.js').

export interface DohRowDef {
  type: 'header' | 'data' | 'sub';
  /** Layout key of the row (rows added from the right-click menu have their own). */
  key: string;
  label: string;
  field?: string;
  indent?: boolean;
  /** A row the user added: no computed values, cells hold typed text. */
  added?: boolean;
}

/** One column unit of the sheet: a Male/Female pair (age bracket, a grade's total,
 *  a summary bracket) or, when `added`, a single typed column. Hidden columns are
 *  simply not passed, so the file holds what the screen shows. */
export interface DohXlsxUnit {
  key: string;
  /** Header group over the unit (a grade, "SUMMARY", or the group an added column joined). */
  group: string;
  groupKind: 'grade' | 'summary';
  label: string;
  /** Emphasis of the unit's header and numbers (a grade's Total). */
  total?: boolean;
  added?: boolean;
  /** Computed value for a row's field and sex. */
  value?: (field: string, sex: 'M' | 'F') => number;
}

export interface DohXlsxParams {
  units: DohXlsxUnit[];
  rows: DohRowDef[];
  /** Text typed into a cell of an added row or column. */
  typed: (rowKey: string, unitKey: string) => string;
  school: string;
  monthYear: string;
  /** Header text of the label column (it can be renamed). */
  labelHeader?: string;
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

export async function buildDohReportXlsx(params: DohXlsxParams): Promise<Blob> {
  const { units, rows, typed, school, monthYear, labelHeader = 'Indicator' } = params;

  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DOH Consolidated');

  // Column geometry: col 1 = Indicator; each unit is two columns (M/F), or one when added.
  const width = (u: DohXlsxUnit) => (u.added ? 1 : 2);
  const totalDataCols = units.reduce((n, u) => n + width(u), 0);
  const lastCol = 1 + Math.max(totalDataCols, 1);

  // ── Row 1: title ──
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1) as unknown as XlsxCell;
  titleCell.value = 'DENTAL SECTION: CONSOLIDATED ORAL HEALTH STATUS AND SERVICE REPORT';
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
  indCell.value = labelHeader;
  indCell.font = { bold: true };
  indCell.alignment = { horizontal: 'left', vertical: 'middle' };

  // Group bands (row 3): runs of units under one group name.
  let col = 2;
  const starts: number[] = [];
  let gi = 0;
  while (gi < units.length) {
    let gj = gi;
    let span = 0;
    while (gj < units.length && units[gj].group === units[gi].group) { starts[gj] = col + span; span += width(units[gj]); gj++; }
    sheet.mergeCells(3, col, 3, col + span - 1);
    const gc = sheet.getCell(3, col) as unknown as XlsxCell;
    gc.value = units[gi].group;
    const summary = units[gi].groupKind === 'summary';
    gc.font = { bold: true, color: { argb: summary ? 'FF6D28D9' : 'FF1E40AF' } };
    gc.alignment = { horizontal: 'center' };
    gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: summary ? SUMMARY_FILL : GRADE_FILL } };
    col += span;
    gi = gj;
  }
  // Unit labels (row 4) and M/F (row 5).
  units.forEach((u, i) => {
    const c = starts[i];
    if (u.added) {
      sheet.mergeCells(4, c, 5, c);
      const ac = sheet.getCell(4, c) as unknown as XlsxCell;
      ac.value = u.label;
      ac.alignment = { horizontal: 'center', vertical: 'middle' };
      ac.font = { size: 8 };
      return;
    }
    sheet.mergeCells(4, c, 4, c + 1);
    const ac = sheet.getCell(4, c) as unknown as XlsxCell;
    ac.value = u.label;
    ac.alignment = { horizontal: 'center' };
    ac.font = u.total ? { bold: true, color: { argb: 'FF1D4ED8' } } : { size: 8 };
    (sheet.getCell(5, c) as unknown as XlsxCell).value = 'M';
    (sheet.getCell(5, c + 1) as unknown as XlsxCell).value = 'F';
  });
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

    units.forEach((u, i) => {
      const c = starts[i];
      if (row.added || u.added) {
        // A typed cell spans the unit's width (a pair unit is two columns wide).
        if (!u.added) sheet.mergeCells(r, c, r, c + 1);
        const tc = sheet.getCell(r, c) as unknown as XlsxCell;
        tc.value = typed(row.key, u.key);
        tc.alignment = { horizontal: 'center' };
        tc.font = { size: 9 };
        return;
      }
      setNum(sheet.getCell(r, c) as unknown as XlsxCell, u.value!(field, 'M'), !!u.total);
      setNum(sheet.getCell(r, c + 1) as unknown as XlsxCell, u.value!(field, 'F'), !!u.total);
    });
    r++;
  }
  const lastRow = r - 1;

  // ── Column widths ── Indicator wide, data columns narrow (M/F single digits).
  sheet.getColumn(1).width = 42;
  for (let cc = 2; cc <= lastCol; cc++) sheet.getColumn(cc).width = 5;
  units.forEach((u, i) => { if (u.added) sheet.getColumn(starts[i]).width = 14; });

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
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
