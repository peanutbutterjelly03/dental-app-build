import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildDohReportXlsx, type DohXlsxUnit, type DohRowDef } from './exportDohXlsx';

const units: DohXlsxUnit[] = [
  { key: 'K|5-9', group: 'KINDER', groupKind: 'grade', label: '5-9 yrs', value: (_f, s) => (s === 'M' ? 3 : 2) },
  { key: 'K|T', group: 'KINDER', groupKind: 'grade', label: 'Total', total: true, value: (_f, s) => (s === 'M' ? 3 : 2) },
  { key: 'col_x', group: 'KINDER', groupKind: 'grade', label: 'Remarks', added: true },
  { key: 'S|5-9', group: 'SUMMARY', groupKind: 'summary', label: '5-9 yrs', value: () => 1 },
];
const rows: DohRowDef[] = [
  { type: 'header', key: 'r0', label: 'MEDICAL HISTORY STATUS' },
  { type: 'data', key: 'r1', label: 'No. of Person Attended', field: 'attended' },
  { type: 'data', key: 'row_y', label: 'My indicator', added: true },
];

describe('DOH Excel export follows the layout', () => {
  it('writes only the units it is given, typed cells for added ones, and a header per unit', async () => {
    const blob = await buildDohReportXlsx({ units, rows, typed: (r, c) => (r === 'row_y' && c === 'col_x' ? 'hello' : r === 'row_y' ? 'typed' : ''), school: 'S', monthYear: 'M' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.worksheets[0];
    // Columns: A label, B:C pair, D:E total pair, F added, G:H summary pair.
    expect(ws.getCell(3, 2).value).toBe('KINDER');
    expect(ws.getCell(4, 6).value).toBe('Remarks');
    expect(ws.getCell(3, 7).value).toBe('SUMMARY');
    expect(ws.getCell(7, 2).value).toBe(3); // attended male, first pair
    expect(ws.getCell(7, 3).value).toBe(2);
    expect(ws.getCell(8, 6).value).toBe('hello'); // added row x added column
    expect(ws.getCell(8, 2).value).toBe('typed'); // added row writes across a computed column
    expect(ws.columnCount).toBe(8);
  });
});
