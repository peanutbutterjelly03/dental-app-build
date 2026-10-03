import { downloadBlob, type ExportColumn } from './exportCsv';

// Same (rows, columns, filename) contract as exportToCsv, producing a real
// .xlsx workbook. exceljs (~1MB) is dynamic-imported so only users who pick
// Excel download it — same bundle-protection pattern as the OCR module.
export async function exportToXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
  sheetName = 'Export',
): Promise<void> {
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
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}
