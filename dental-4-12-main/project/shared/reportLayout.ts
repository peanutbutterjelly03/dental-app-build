// Right-click table layout (Sprint "report tables"): which columns a user hid,
// which rows and columns they added, renamed labels, and the text typed into the
// cells of added rows and columns. Stored once per report table, shared by
// everyone who opens it. This is a LAYOUT, never data: a number computed from
// the database can neither be edited nor replaced here. Only labels and the
// cells of rows/columns the user added are editable.

/** Every report table that carries a layout. Add a key here when a table is wired. */
export const REPORT_KEYS = [
  'procedure_counts', 'condition_counts', 'school_summary',
  'doh_consolidated', 'program_report', 'fhsis', 'target_client_list', 'others_referrals',
] as const;
export type ReportKey = typeof REPORT_KEYS[number];

export interface AddedItem { key: string; label: string; /** Key it sits after; null = at the very start. */ after: string | null }
export interface LabelOverride { key: string; value: string }
export interface CellValue { row: string; col: string; value: string }

export interface ReportLayout {
  report_key: ReportKey;
  hidden_cols: string[];
  hidden_rows: string[];
  added_cols: AddedItem[];
  added_rows: AddedItem[];
  /** Keys are `c:<columnKey>` or `r:<rowKey>`. */
  labels: LabelOverride[];
  cells: CellValue[];
}

export const emptyLayout = (report_key: ReportKey): ReportLayout => ({
  report_key, hidden_cols: [], hidden_rows: [], added_cols: [], added_rows: [], labels: [], cells: [],
});

export interface LCol { key: string; label: string; /** Header group the column sits under (e.g. a grade). */ group?: string; added?: boolean; /** Never hidden (the label column). */ locked?: boolean }
export interface LRow { key: string; label: string; added?: boolean }

// Hard caps. They guard the API (a layout is a document, not a data store) and
// keep a runaway edit from bloating every report load.
export const LIMITS = { cols: 40, rows: 100, cells: 2000, label: 120, cell: 200, hidden: 400, labels: 400 };

/** Insert each added item after its anchor, in the order they were added. An
 *  anchor that no longer exists puts the item at the end rather than losing it. */
function withAdded<T extends { key: string }>(base: T[], added: AddedItem[], make: (a: AddedItem, anchor: T | undefined) => T): T[] {
  const out = base.slice();
  for (const a of added) {
    if (out.some((x) => x.key === a.key)) continue;
    if (a.after === null) { out.unshift(make(a, undefined)); continue; }
    const at = out.findIndex((x) => x.key === a.after);
    if (at === -1) out.push(make(a, undefined));
    else out.splice(at + 1, 0, make(a, out[at]));
  }
  return out;
}

const labelOf = (layout: ReportLayout, prefix: 'c' | 'r', key: string, fallback: string) =>
  layout.labels.find((l) => l.key === `${prefix}:${key}`)?.value ?? fallback;

/** The columns to draw: added columns inserted, labels renamed, hidden ones removed. */
export function layoutColumns(base: LCol[], layout: ReportLayout): LCol[] {
  const all = withAdded(base, layout.added_cols, (a, anchor) => ({ key: a.key, label: a.label, group: anchor?.group, added: true }));
  const hidden = new Set(layout.hidden_cols);
  return all
    .filter((c) => c.locked || !hidden.has(c.key))
    .map((c) => ({ ...c, label: labelOf(layout, 'c', c.key, c.label) }));
}

/** The rows to draw: added rows inserted, hidden rows removed, labels renamed. */
export function layoutRows(base: LRow[], layout: ReportLayout): LRow[] {
  const hidden = new Set(layout.hidden_rows);
  return withAdded(base, layout.added_rows, (a) => ({ key: a.key, label: a.label, added: true }))
    .filter((r) => !hidden.has(r.key))
    .map((r) => ({ ...r, label: labelOf(layout, 'r', r.key, r.label) }));
}

/** Rows split over several lists (a form's sections). An added row joins the list
 *  that holds its anchor, so it appears once, in the right section; a row added
 *  at the very start goes to the first list. */
export function layoutRowGroups(lists: LRow[][], layout: ReportLayout): LRow[][] {
  const home = new Map<string, number>();
  lists.forEach((l, i) => l.forEach((r) => home.set(r.key, i)));
  const perList: AddedItem[][] = lists.map(() => []);
  for (const a of layout.added_rows) {
    const at = a.after === null ? 0 : home.get(a.after);
    if (at === undefined) continue;
    home.set(a.key, at);
    perList[at].push(a);
  }
  return lists.map((l, i) => layoutRows(l, { ...layout, added_rows: perList[i] }));
}

export const cellText = (layout: ReportLayout, row: string, col: string): string =>
  layout.cells.find((c) => c.row === row && c.col === col)?.value ?? '';

/** A computed cell is locked. Only a cell whose row or column was added by the user can be typed into. */
export const isEditableCell = (rowAdded: boolean, colAdded: boolean) => rowAdded || colAdded;

const newKey = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function addColumn(layout: ReportLayout, after: string | null, label: string): ReportLayout {
  if (layout.added_cols.length >= LIMITS.cols) return layout;
  return { ...layout, added_cols: [...layout.added_cols, { key: newKey('col'), label: label.trim().slice(0, LIMITS.label) || 'New column', after }] };
}
export function addRow(layout: ReportLayout, after: string | null, label: string): ReportLayout {
  if (layout.added_rows.length >= LIMITS.rows) return layout;
  return { ...layout, added_rows: [...layout.added_rows, { key: newKey('row'), label: label.trim().slice(0, LIMITS.label) || 'New row', after }] };
}
export function hideColumns(layout: ReportLayout, keys: string[]): ReportLayout {
  return { ...layout, hidden_cols: [...new Set([...layout.hidden_cols, ...keys])].slice(0, LIMITS.hidden) };
}
export const showAllColumns = (layout: ReportLayout): ReportLayout => ({ ...layout, hidden_cols: [] });
export function hideRows(layout: ReportLayout, keys: string[]): ReportLayout {
  return { ...layout, hidden_rows: [...new Set([...layout.hidden_rows, ...keys])].slice(0, LIMITS.hidden) };
}
export const showAllRows = (layout: ReportLayout): ReportLayout => ({ ...layout, hidden_rows: [] });
/** Bring back every hidden row and column. */
export const showAll = (layout: ReportLayout): ReportLayout => ({ ...layout, hidden_cols: [], hidden_rows: [] });
export function setLabel(layout: ReportLayout, prefix: 'c' | 'r', key: string, value: string): ReportLayout {
  const k = `${prefix}:${key}`;
  const rest = layout.labels.filter((l) => l.key !== k);
  const v = value.trim().slice(0, LIMITS.label);
  // An added item keeps its own label; renaming it just rewrites that.
  const list = prefix === 'c' ? layout.added_cols : layout.added_rows;
  const isAdded = list.some((a) => a.key === key);
  if (isAdded) {
    const patched = list.map((a) => (a.key === key ? { ...a, label: v || a.label } : a));
    return prefix === 'c' ? { ...layout, added_cols: patched, labels: rest } : { ...layout, added_rows: patched, labels: rest };
  }
  return { ...layout, labels: v ? [...rest, { key: k, value: v }].slice(0, LIMITS.labels) : rest };
}
export function setCell(layout: ReportLayout, row: string, col: string, value: string): ReportLayout {
  const rest = layout.cells.filter((c) => !(c.row === row && c.col === col));
  const v = value.slice(0, LIMITS.cell);
  return { ...layout, cells: v.trim() ? [...rest, { row, col, value: v }].slice(0, LIMITS.cells) : rest };
}
/** Drop an added column/row and everything typed into it. */
export function removeAdded(layout: ReportLayout, kind: 'c' | 'r', key: string): ReportLayout {
  return {
    ...layout,
    added_cols: kind === 'c' ? layout.added_cols.filter((a) => a.key !== key) : layout.added_cols,
    added_rows: kind === 'r' ? layout.added_rows.filter((a) => a.key !== key) : layout.added_rows,
    cells: layout.cells.filter((c) => (kind === 'c' ? c.col !== key : c.row !== key)),
    labels: layout.labels.filter((l) => l.key !== `${kind}:${key}`),
  };
}
export const resetLayout = (layout: ReportLayout): ReportLayout => emptyLayout(layout.report_key);

/** Why a layout is not acceptable, or an empty list. Used by the API on every write. */
export function layoutProblems(body: Partial<ReportLayout>): string[] {
  const p: string[] = [];
  if (body.report_key !== undefined && !(REPORT_KEYS as readonly string[]).includes(body.report_key)) p.push('Unknown report.');
  const arr = (v: unknown, max: number, name: string) => {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length > max) p.push(`${name} is too long.`);
  };
  arr(body.hidden_cols, LIMITS.hidden, 'Hidden columns');
  arr(body.hidden_rows, LIMITS.hidden, 'Hidden rows');
  arr(body.added_cols, LIMITS.cols, 'Added columns');
  arr(body.added_rows, LIMITS.rows, 'Added rows');
  arr(body.labels, LIMITS.labels, 'Labels');
  arr(body.cells, LIMITS.cells, 'Cells');
  const tooLong = (s: unknown, max: number) => typeof s !== 'string' || s.length > max;
  for (const a of [...(body.added_cols ?? []), ...(body.added_rows ?? [])]) {
    if (tooLong(a?.key, 64) || tooLong(a?.label, LIMITS.label) || (a?.after !== null && tooLong(a?.after, 64))) { p.push('An added row or column is not valid.'); break; }
  }
  for (const l of body.labels ?? []) if (tooLong(l?.key, 80) || tooLong(l?.value, LIMITS.label)) { p.push('A label is not valid.'); break; }
  for (const c of body.cells ?? []) if (tooLong(c?.row, 64) || tooLong(c?.col, 64) || tooLong(c?.value, LIMITS.cell)) { p.push('A cell is not valid.'); break; }
  for (const k of body.hidden_cols ?? []) if (tooLong(k, 80)) { p.push('A hidden column is not valid.'); break; }
  for (const k of body.hidden_rows ?? []) if (tooLong(k, 80)) { p.push('A hidden row is not valid.'); break; }
  return p;
}
