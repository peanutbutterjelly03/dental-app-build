import { describe, it, expect } from 'vitest';
import { emptyLayout, layoutColumns, layoutRows, layoutRowGroups, hideRows, showAll, addColumn, addRow, hideColumns, showAllColumns, setLabel, setCell, removeAdded, isEditableCell, cellText, layoutProblems, type LCol, type LRow } from './reportLayout';

const cols: LCol[] = [
  { key: 'name', label: 'Procedure', locked: true },
  { key: 'a|M', label: 'MALE', group: 'A' }, { key: 'a|F', label: 'FEMALE', group: 'A' },
  { key: 'b|M', label: 'MALE', group: 'B' },
];
const rows: LRow[] = [{ key: 'r1', label: 'One' }, { key: 'r2', label: 'Two' }];
const base = () => emptyLayout('procedure_counts');

describe('report layout', () => {
  it('draws the base columns untouched for an empty layout', () => {
    expect(layoutColumns(cols, base()).map((c) => c.key)).toEqual(['name', 'a|M', 'a|F', 'b|M']);
  });
  it('hides columns but never a locked one', () => {
    const l = hideColumns(base(), ['a|M', 'name']);
    expect(layoutColumns(cols, l).map((c) => c.key)).toEqual(['name', 'a|F', 'b|M']);
  });
  it('shows hidden columns again', () => {
    expect(layoutColumns(cols, showAllColumns(hideColumns(base(), ['a|M']))).length).toBe(4);
  });
  it('adds a column after an anchor and inherits its group', () => {
    const l = addColumn(base(), 'a|F', 'Notes');
    const out = layoutColumns(cols, l);
    expect(out.map((c) => c.label)).toEqual(['Procedure', 'MALE', 'FEMALE', 'Notes', 'MALE']);
    expect(out[3].group).toBe('A');
    expect(out[3].added).toBe(true);
  });
  it('adds a column at the very start with a null anchor', () => {
    expect(layoutColumns(cols, addColumn(base(), null, 'First'))[0].label).toBe('First');
  });
  it('keeps an added column even when its anchor is hidden', () => {
    const added = addColumn(base(), 'a|M', 'Notes');
    const l = hideColumns(added, ['a|M']);
    expect(layoutColumns(cols, l).some((c) => c.label === 'Notes')).toBe(true);
  });
  it('adds rows above and below', () => {
    const l = addRow(addRow(base(), 'r1', 'Below one'), null, 'Top');
    expect(layoutRows(rows, l).map((r) => r.label)).toEqual(['Top', 'One', 'Below one', 'Two']);
  });
  it('renames a base column and an added one', () => {
    let l = setLabel(base(), 'c', 'a|M', 'Boys');
    expect(layoutColumns(cols, l)[1].label).toBe('Boys');
    l = addColumn(l, null, 'Temp');
    const key = l.added_cols[0].key;
    l = setLabel(l, 'c', key, 'Renamed');
    expect(layoutColumns(cols, l)[0].label).toBe('Renamed');
  });
  it('only lets cells of added rows or columns be edited', () => {
    expect(isEditableCell(false, false)).toBe(false);
    expect(isEditableCell(true, false)).toBe(true);
    expect(isEditableCell(false, true)).toBe(true);
  });
  it('stores and clears cell text', () => {
    let l = setCell(base(), 'r1', 'col_x', 'hello');
    expect(cellText(l, 'r1', 'col_x')).toBe('hello');
    l = setCell(l, 'r1', 'col_x', '  ');
    expect(cellText(l, 'r1', 'col_x')).toBe('');
  });
  it('removing an added column drops its cells', () => {
    let l = addColumn(base(), null, 'X');
    const key = l.added_cols[0].key;
    l = setCell(l, 'r1', key, 'v');
    l = removeAdded(l, 'c', key);
    expect(l.added_cols.length + l.cells.length).toBe(0);
  });
  it('rejects oversize or unknown input', () => {
    expect(layoutProblems({ report_key: 'nope' as never })).not.toEqual([]);
    expect(layoutProblems({ cells: [{ row: 'r', col: 'c', value: 'x'.repeat(500) }] })).not.toEqual([]);
    expect(layoutProblems({ report_key: 'procedure_counts', hidden_cols: ['a'] })).toEqual([]);
  });
  it('hides rows and brings them back with showAll', () => {
    const l = hideRows(base(), ['r1']);
    expect(layoutRows(rows, l).map((r) => r.key)).toEqual(['r2']);
    expect(layoutRows(rows, showAll(l)).length).toBe(2);
  });
  it('puts an added row in the section that holds its anchor, once', () => {
    const lists: LRow[][] = [[{ key: 'a1', label: 'A1' }], [{ key: 'b1', label: 'B1' }]];
    const l = addRow(addRow(base(), 'b1', 'In B'), null, 'At start');
    const [first, second] = layoutRowGroups(lists, l);
    expect(first.map((r) => r.label)).toEqual(['At start', 'A1']);
    expect(second.map((r) => r.label)).toEqual(['B1', 'In B']);
  });
});
