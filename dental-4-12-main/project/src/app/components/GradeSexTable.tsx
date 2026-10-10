import type { ReactNode } from 'react';
import { cellText, layoutColumns, layoutRows, type LCol, type LRow } from '../../../shared/reportLayout';
import type { ReportLayoutApi } from '../hooks/useReportLayout';
import { ReportLayoutMenu, HiddenColumnsNote } from './ReportLayoutMenu';

// The Procedure Counts and Condition Counts tables: one label column, then
// MALE / FEMALE / TOTAL under every grade, then the same three for all grades
// together. Both tables share this component so they behave identically, and
// both read their layout (hidden columns, added rows and columns, renamed
// labels) from the saved report layout.

export type Sex = 'M' | 'F' | 'T';
const SEXES: { s: Sex; label: string }[] = [{ s: 'M', label: 'MALE' }, { s: 'F', label: 'FEMALE' }, { s: 'T', label: 'TOTAL' }];
export const TOTAL_ROW = '__total';

interface GridInput {
  api: ReportLayoutApi;
  rowHeader: string;
  baseRows: LRow[];
  grades: string[];
  /** Count for a row in one grade ('all' = every grade shown) and sex. Computed from the database. */
  count: (rowKey: string, grade: string, sex: 'M' | 'F') => number;
  showTotalRow: boolean;
}

/** Every column of the table before the layout is applied. */
export const baseColumns = (rowHeader: string, grades: string[]): LCol[] => [
  { key: 'label', label: rowHeader, locked: true },
  ...grades.flatMap((g) => SEXES.map(({ s, label }) => ({ key: `${g}|${s}`, label, group: g }))),
  ...SEXES.map(({ s, label }) => ({ key: `all|${s}`, label, group: 'TOTAL' })),
];

const value = (input: GridInput, rowKey: string, colKey: string): number => {
  const [g, s] = colKey.split('|');
  if (s === 'T') return input.count(rowKey, g, 'M') + input.count(rowKey, g, 'F');
  return input.count(rowKey, g, s as 'M' | 'F');
};

/** The grid as plain data, for the Excel file: what the screen draws, no more and no less. */
export function gridData(input: GridInput) {
  const { layout } = input.api;
  const cols = layoutColumns(baseColumns(input.rowHeader, input.grades), layout);
  const rows = layoutRows(input.baseRows, layout);
  const cell = (rowKey: string, rowAdded: boolean, c: LCol): string | number => {
    if (c.locked) return '';
    if (rowAdded || c.added) return cellText(layout, rowKey, c.key);
    return value(input, rowKey, c.key);
  };
  const body = rows.map((r) => ({ label: r.label, cells: cols.filter((c) => !c.locked).map((c) => cell(r.key, !!r.added, c)) }));
  if (input.showTotalRow) {
    body.push({
      label: 'TOTAL',
      cells: cols.filter((c) => !c.locked).map((c) =>
        c.added ? cellText(layout, TOTAL_ROW, c.key) : input.baseRows.reduce((n, r) => n + value(input, r.key, c.key), 0)),
    });
  }
  return { cols: cols.filter((c) => !c.locked), rowHeader: cols[0]?.label ?? input.rowHeader, body };
}

export function GradeSexTable(props: GridInput & { eyebrow: string; title: string; chips?: ReactNode }) {
  const { api, rowHeader, baseRows, grades, showTotalRow, eyebrow, title, chips } = props;
  const { layout } = api;
  const cols = layoutColumns(baseColumns(rowHeader, grades), layout);
  const rows = layoutRows(baseRows, layout);
  const leafCols = cols.filter((c) => !c.locked);

  // Header groups, in order: a run of leaf columns under one group name.
  const groups: { name: string; keys: string[] }[] = [];
  for (const c of leafCols) {
    const g = c.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.name === g) last.keys.push(c.key);
    else groups.push({ name: g, keys: [c.key] });
  }
  const groupIndex = new Map<string, number>();
  groups.forEach((g, i) => g.keys.forEach((k) => groupIndex.set(k, i)));
  const isTotalGroup = (name: string) => name === 'TOTAL';
  const hShade = (name: string, i: number) => (isTotalGroup(name) ? 'bg-[#2c4690]' : i % 2 ? 'bg-[#233a7a]' : 'bg-[#1b2d63]');
  const bShade = (key: string) => {
    const i = groupIndex.get(key) ?? 0;
    const name = groups[i]?.name ?? '';
    return isTotalGroup(name) ? 'bg-[#eef3fd]' : i % 2 ? 'bg-[#f5f8fe]' : '';
  };
  const labelCol = cols[0];

  const tone = (key: string) => (key.endsWith('|M') ? 'text-blue-700' : key.endsWith('|F') ? 'text-pink-700' : 'font-bold text-foreground');
  const typed = 'text-foreground';

  const bodyCell = (r: LRow, c: LCol) => {
    const common = { 'data-ck': c.key, 'data-rk': r.key } as const;
    if (r.added || c.added) {
      return <td key={c.key} {...common} className={`px-1.5 py-2.5 text-center ${typed} ${bShade(c.key)}`}>{cellText(layout, r.key, c.key)}</td>;
    }
    const v = value(props, r.key, c.key);
    return <td key={c.key} {...common} className={`px-1.5 py-2.5 text-center tabular-nums ${tone(c.key)} ${bShade(c.key)}`}>{v}</td>;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#A9BDE6] bg-card">
      <div className="bg-gradient-to-br from-[#273c7b] to-[#1b2d63] px-5 py-3.5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#aebbe0]">{eyebrow}</div>
            <div className="text-lg font-extrabold">{title}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <HiddenColumnsNote api={api} />
            {chips}
          </div>
        </div>
      </div>
      <ReportLayoutMenu api={api} columns={cols} rows={rows}>
        <div className="no-scrollbar overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse', minWidth: `${Math.max(480, 230 + leafCols.length * 66)}px` }}>
            <thead>
              <tr className="bg-[#1b2d63]">
                <th rowSpan={2} data-ck={labelCol.key} className="min-w-[220px] px-4 py-2 text-left text-[11px] font-extrabold tracking-wide text-white">{labelCol.label}</th>
                {groups.map((g, i) => (
                  <th key={`${g.name}-${i}`} colSpan={g.keys.length} data-cg={g.keys.join(',')} data-cgl={g.name}
                    className={`px-1.5 py-2 text-center text-[11px] font-extrabold tracking-wide text-white whitespace-nowrap ${hShade(g.name, i)}`}>{g.name.toUpperCase()}</th>
                ))}
              </tr>
              <tr className="bg-[#1b2d63]">
                {leafCols.map((c) => (
                  <th key={c.key} data-ck={c.key}
                    className={`px-1.5 py-1.5 text-center text-[10px] font-bold text-white/90 whitespace-nowrap ${hShade(groups[groupIndex.get(c.key) ?? 0]?.name ?? '', groupIndex.get(c.key) ?? 0)}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-rk={r.key} className="border-b border-[#dfe5f0] hover:bg-[#f8faff]">
                  <td data-ck={labelCol.key} data-rk={r.key} className="px-4 py-2.5 font-medium text-foreground">{r.label}</td>
                  {leafCols.map((c) => bodyCell(r, c))}
                </tr>
              ))}
              {showTotalRow && (
                <tr data-rk={TOTAL_ROW} className="border-t-2 border-[#dfe5f0] font-extrabold">
                  <td data-ck={labelCol.key} data-rk={TOTAL_ROW} className="px-4 py-2.5">TOTAL</td>
                  {leafCols.map((c) => (
                    <td key={c.key} data-ck={c.key} data-rk={TOTAL_ROW} className={`px-1.5 py-2.5 text-center ${c.added ? typed : `tabular-nums ${tone(c.key)}`} ${bShade(c.key)}`}>
                      {c.added ? cellText(layout, TOTAL_ROW, c.key) : baseRows.reduce((n, r) => n + value(props, r.key, c.key), 0)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ReportLayoutMenu>
      {api.error && <p className="print-hide px-4 py-2 text-xs text-destructive">{api.error}</p>}
    </div>
  );
}
