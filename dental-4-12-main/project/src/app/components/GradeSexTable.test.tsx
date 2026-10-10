// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradeSexTable, gridData } from './GradeSexTable';
import { addColumn, addRow, hideColumns, setCell, emptyLayout, type ReportLayout } from '../../../shared/reportLayout';
import type { ReportLayoutApi } from '../hooks/useReportLayout';

const api = (layout: ReportLayout): ReportLayoutApi => ({ layout, update: () => {}, canEdit: true, error: null });
const input = (layout: ReportLayout) => ({
  api: api(layout), rowHeader: 'PROCEDURE', showTotalRow: true, grades: ['Kinder', 'Grade 1'],
  baseRows: [{ key: 'EX', label: 'Extraction' }, { key: 'FV', label: 'Fluoride Varnish' }],
  count: (r: string, g: string, s: 'M' | 'F') => (r === 'EX' ? 2 : 1) + (s === 'F' ? 1 : 0) + (g === 'all' ? 10 : 0),
});

describe('GradeSexTable and the saved layout', () => {
  it('draws every grade with Male, Female and Total, and the totals', () => {
    const g = gridData(input(emptyLayout('procedure_counts')));
    expect(g.cols.length).toBe(2 * 3 + 3);
    expect(g.body.length).toBe(3); // two rows + TOTAL
    expect(g.body[0].cells[0]).toBe(2); // Kinder male for EX
    expect(g.body[0].cells[2]).toBe(5); // Kinder total for EX
    expect(g.body[2].label).toBe('TOTAL');
  });
  it('leaves a hidden column out of the screen markup and the file data', () => {
    let l = hideColumns(emptyLayout('procedure_counts'), ['Kinder|F']);
    const html = renderToStaticMarkup(<GradeSexTable {...input(l)} eyebrow="X" title="T" />);
    expect(html).not.toContain('data-ck="Kinder|F"');
    expect(html).toContain('data-ck="Kinder|M"');
    expect(gridData(input(l)).cols.some((c) => c.key === 'Kinder|F')).toBe(false);
  });
  it('shows an added row and column with their typed text, and locks computed cells', () => {
    let l = addColumn(emptyLayout('procedure_counts'), 'Kinder|T', 'Remarks');
    const colKey = l.added_cols[0].key;
    l = addRow(l, 'EX', 'Custom row');
    const rowKey = l.added_rows[0].key;
    l = setCell(l, rowKey, colKey, 'typed');
    const html = renderToStaticMarkup(<GradeSexTable {...input(l)} eyebrow="X" title="T" />);
    expect(html).toContain('Remarks');
    expect(html).toContain('Custom row');
    expect(html).toContain('typed');
    const g = gridData(input(l));
    expect(g.body.find((r) => r.label === 'Custom row')?.cells.includes('typed')).toBe(true);
  });
});
