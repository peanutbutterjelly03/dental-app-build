import type { ExportColumn } from './exportCsv';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Same (rows, columns) contract as exportToCsv, producing a real .xlsx
// workbook as a Blob for the caller to preview/download. exceljs (~1MB) is
// dynamic-imported so only users who pick Excel download it — same
// bundle-protection pattern as the OCR module.
export async function buildXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  sheetName = 'Export',
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.label,
    // Width from the longer of header and typical values, clamped to sane bounds
    width: Math.min(40, Math.max(10, c.label.length + 2)),
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(columns.map((c) => c.value(row) ?? ''));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/** One sheet of a multi-sheet workbook. */
export interface ExportSheet<T> {
  name: string;
  rows: T[];
  columns: ExportColumn<T>[];
}

/**
 * Sprint 134 — several sheets in ONE workbook.
 *
 * The Target Client List is a TWO-PAGE form (manuscript Appendix E holds both
 * scans): page 1 carries identity + oral health status, page 2 the visit and
 * services groups, and the two are joined by the `No.` column. Emitting one
 * very wide sheet was not the form, and CLAUDE.md's rule is that a form is
 * reproduced exactly, every page included.
 *
 * Deliberately a second function rather than a flag on `buildXlsx`: the
 * single-sheet contract is used by other reports and there is no reason to
 * make them all think about sheets.
 */
export async function buildSheetsXlsx<T>(sheets: ExportSheet<T>[]): Promise<Blob> {
  if (sheets.length === 0) throw new Error('buildSheetsXlsx called with no sheets');
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const workbook = new ExcelJS.Workbook();

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.columns = spec.columns.map((c) => ({
      header: c.label,
      width: Math.min(40, Math.max(10, c.label.length + 2)),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of spec.rows) {
      sheet.addRow(spec.columns.map((c) => c.value(row) ?? ''));
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}
