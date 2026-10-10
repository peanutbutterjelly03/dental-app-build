import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addColumn, addRow, hideColumns, removeAdded, resetLayout, setCell, setLabel, showAllColumns, isEditableCell, cellText,
  type LCol, type LRow,
} from '../../../shared/reportLayout';
import type { ReportLayoutApi } from '../hooks/useReportLayout';

// Right-click menu for a report table: add a row or column, hide a column,
// rename a column or row, and type into the cells of rows/columns the user
// added. A figure computed from the database is never editable here.
//
// A table opts in by wrapping itself in <ReportLayoutMenu> and tagging its
// cells with data attributes:
//   data-ck="<column key>"            on every header and body cell of a column
//   data-rk="<row key>"               on every cell of a body row
//   data-cg="<key>,<key>" data-cgl="Grade 1"   on a group header: its leaf columns
// and by drawing its columns/rows from layoutColumns()/layoutRows().

interface Target { ck?: string; rk?: string; cg?: string[]; cgl?: string }
type Mode =
  | { kind: 'menu' }
  | { kind: 'input'; title: string; initial: string; onSubmit: (value: string) => void };

const parse = (el: Element | null): Target => {
  const group = el?.closest<HTMLElement>('[data-cg]');
  const col = el?.closest<HTMLElement>('[data-ck]');
  const row = el?.closest<HTMLElement>('[data-rk]');
  return {
    ck: col?.dataset.ck,
    rk: row?.dataset.rk,
    cg: group ? (group.dataset.cg ?? '').split(',').filter(Boolean) : undefined,
    cgl: group?.dataset.cgl,
  };
};

export function ReportLayoutMenu({ api, columns, rows, children }: {
  api: ReportLayoutApi; columns: LCol[]; rows: LRow[]; children: ReactNode;
}) {
  const { layout, update, canEdit } = api;
  const [at, setAt] = useState<{ x: number; y: number; t: Target } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  const box = useRef<HTMLDivElement>(null);
  const close = () => { setAt(null); setMode({ kind: 'menu' }); };

  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);

  if (!canEdit) return <>{children}</>;

  const col = (key?: string) => columns.find((c) => c.key === key);
  const row = (key?: string) => rows.find((r) => r.key === key);

  const open = (x: number, y: number, t: Target, initial?: Mode) => {
    setAt({ x, y, t });
    setMode(initial ?? { kind: 'menu' });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const t = parse(e.target as Element);
    if (!t.ck && !t.rk && !t.cg) return; // not a cell of the table: leave the browser's own menu
    e.preventDefault();
    open(e.clientX, e.clientY, t);
  };

  // A double click on a cell the user may type into opens the same box.
  const onDoubleClick = (e: React.MouseEvent) => {
    const t = parse(e.target as Element);
    if (!t.ck || !t.rk) return;
    const c = col(t.ck);
    const r = row(t.rk);
    if (!isEditableCell(!!r?.added, !!c?.added)) return;
    e.preventDefault();
    editCell(e.clientX, e.clientY, t);
  };

  const editCell = (x: number, y: number, t: Target) => {
    const ck = t.ck!, rk = t.rk!;
    open(x, y, t, {
      kind: 'input', title: 'Edit cell', initial: cellText(layout, rk, ck),
      onSubmit: (v) => update((l) => setCell(l, rk, ck, v)),
    });
  };

  const ask = (title: string, initial: string, onSubmit: (v: string) => void) => setMode({ kind: 'input', title, initial, onSubmit });

  const t = at?.t;
  const c = col(t?.ck);
  const r = row(t?.rk);
  const colIdx = c ? columns.findIndex((x) => x.key === c.key) : -1;
  const prevCol = colIdx > 0 ? columns[colIdx - 1].key : null;
  const rowIdx = r ? rows.findIndex((x) => x.key === r.key) : -1;
  const prevRow = rowIdx > 0 ? rows[rowIdx - 1].key : null;
  const editable = !!(t?.ck && t?.rk) && isEditableCell(!!r?.added, !!c?.added);
  const hiddenCount = layout.hidden_cols.length;
  const lastRow = rows.length ? rows[rows.length - 1].key : null;

  const item = (label: string, run: () => void, opts: { danger?: boolean } = {}) => (
    <button key={label} type="button" role="menuitem"
      onClick={() => { run(); }}
      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#eef3fd] ${opts.danger ? 'text-destructive' : 'text-foreground'}`}>{label}</button>
  );
  const sep = (k: string) => <div key={k} className="my-1 border-t border-[#e3e7ef]" />;
  const done = (fn: () => void) => () => { fn(); close(); };

  return (
    <div onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} className="contents">
      {children}
      {at && (
        <div ref={box} role="menu" aria-label="Table options"
          style={{ position: 'fixed', left: Math.min(at.x, window.innerWidth - 250), top: Math.min(at.y, window.innerHeight - 330), zIndex: 60 }}
          className="print-hide w-60 rounded-xl border border-[#dfe6f4] bg-white py-1.5 shadow-[0_18px_34px_-14px_rgba(20,33,61,0.45)]">
          {mode.kind === 'input' ? (
            <InputStep title={mode.title} initial={mode.initial}
              onCancel={close}
              onSubmit={(v) => { mode.onSubmit(v); close(); }} />
          ) : (
            <>
              {t?.ck && c && (
                <>
                  {!c.locked && item('Add column to the left', () => ask('New column name', '', (v) => update((l) => addColumn(l, prevCol, v))))}
                  {item('Add column to the right', () => ask('New column name', '', (v) => update((l) => addColumn(l, c.key, v))))}
                  {item('Rename column', () => ask('Column name', c.label, (v) => update((l) => setLabel(l, 'c', c.key, v))))}
                  {!c.locked && !c.added && item('Hide column', done(() => update((l) => hideColumns(l, [c.key]))))}
                  {c.added && item('Delete this added column', done(() => update((l) => removeAdded(l, 'c', c.key))), { danger: true })}
                </>
              )}
              {t?.cg && t.cg.length > 0 && !t.ck && item(`Hide ${t.cgl ?? 'these'} columns`, done(() => update((l) => hideColumns(l, t.cg!))))}
              {t?.ck && c && t?.rk && sep('s1')}
              {t?.rk && r && (
                <>
                  {item('Add row above', () => ask('New row name', '', (v) => update((l) => addRow(l, prevRow, v))))}
                  {item('Add row below', () => ask('New row name', '', (v) => update((l) => addRow(l, r.key, v))))}
                  {item('Rename row', () => ask('Row name', r.label, (v) => update((l) => setLabel(l, 'r', r.key, v))))}
                  {r.added && item('Delete this added row', done(() => update((l) => removeAdded(l, 'r', r.key))), { danger: true })}
                </>
              )}
              {t?.rk && !r && lastRow !== undefined && item('Add row above this', () => ask('New row name', '', (v) => update((l) => addRow(l, lastRow, v))))}
              {editable && (
                <>
                  {sep('s2')}
                  {item('Edit cell', () => editCell(at.x, at.y, t!))}
                </>
              )}
              {sep('s3')}
              {hiddenCount > 0 && item(`Show hidden columns (${hiddenCount})`, done(() => update((l) => showAllColumns(l))))}
              {item('Reset table layout', done(() => update((l) => resetLayout(l))), { danger: true })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InputStep({ title, initial, onSubmit, onCancel }: { title: string; initial: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form className="px-3 pb-2 pt-1" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{title}</label>
      <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120}
        className="h-9 w-full rounded-lg border border-[#e3e7ef] bg-[#f1f3f8] px-3 text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-lg px-3 text-[12.5px] font-bold text-muted-foreground hover:bg-[#f1f3f8]">Cancel</button>
        <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">Save</button>
      </div>
    </form>
  );
}

/** Small "n hidden" line shown above a table that has hidden columns, so they can be brought back without a right click. Not printed. */
export function HiddenColumnsNote({ api }: { api: ReportLayoutApi }) {
  const n = api.layout.hidden_cols.length;
  if (!n || !api.canEdit) return null;
  return (
    <button type="button" onClick={() => api.update((l) => showAllColumns(l))}
      className="print-hide rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-white hover:bg-white/25">
      {n} hidden column{n === 1 ? '' : 's'}. Show
    </button>
  );
}
