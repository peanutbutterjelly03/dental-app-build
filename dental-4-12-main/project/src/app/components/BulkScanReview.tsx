import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { REQUIRED_STUDENT_FIELDS, type DuplicateCandidate } from './PatientList';
import type { ExtractedHandoff } from './ScanStudentForm';
import { calculateAge } from '../utils/age';
import { TOPBAR_H } from '../utils/layout';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool } from '../api/types';
import { useToast } from './Toast';
import { schoolYearLabel } from '../utils/schoolYear';
import { validateStudentValues } from '../../../shared/studentValidation';
import { inFileDuplicates, type DupDecisions } from '../utils/bulkDuplicates';

// Bulk upload review (user, 2026-10-01): the OCR button reads several forms or a
// spreadsheet with many rows, and lands HERE first, so every extracted student is
// visible on one page. Grid is the main view and behaves like an Excel sheet with
// frozen panes (header row and Student column); Cards is the second view. Clicking
// a student opens the existing Verify page at that student. Nothing is saved here.
//
// Styled with the same tokens as ScanStudentForm / VerifyStudentForm (literal
// colours and rem values), so the three pages read as one flow.

const VIEW_KEY = 'bulk-scan-view';
const SCROLL_KEY = 'bulk-review-scroll';
const FIXES_KEY = 'bulk-review-fixes';
type View = 'grid' | 'cards';

type Row = { index: number; h: ExtractedHandoff; missing: string[] };

const NAVY = '#273A78';
const MUTED = '#67687A';
const LINE = '#E2E8F0';
const GRID_LINE = '#CBD5E1';
// The last (and first) column keep this much room at their outer edge so the edge tabs never cover text.
const LAST_COL_PAD = '1.75rem';
// Breathing room between the pinned table and the top bar, in px.
const TOP_GAP = 8;
// Pinned row-number column in front of Student; Student is pinned right after it.
const NUM_W = '3.5rem';

const missingOf = (h: ExtractedHandoff): string[] =>
  REQUIRED_STUDENT_FIELDS
    .filter(({ onlyIf }) => (onlyIf ? onlyIf(h.newPatient) : true))
    .filter(({ key }) => !String(h.newPatient[key] ?? '').trim())
    .map((f) => f.label);

/** A student with no name in the file is named by the row it came from, never by the file. */
const fullName = (h: ExtractedHandoff, index: number) => {
  const p = h.newPatient;
  const n = [p.lastName, p.firstName].filter(Boolean).join(', ');
  if (n) return n;
  return typeof h.sourceRowIndex === 'number' ? `Row ${h.sourceRowIndex + 1} (no name)` : `${h.sourceFileName} (no name)`;
};

const pill = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-block', whiteSpace: 'nowrap', borderRadius: '62.4375rem', padding: '0.125rem 0.625rem',
  fontSize: '0.71875rem', fontWeight: 700, background: bg, color: fg,
});

// A possible duplicate not yet decided on the list (2026-10-04). Amber, not red:
// it may be a different child, so it asks for a look, not a fix.
type Dup = { onFile: DuplicateCandidate[]; inFile: number[] };

// Colour by where the other copy is: light RED when the child is already in the student records,
// light YELLOW when the twin is in this same upload (red wins if both).
const dupTone = (dup: Dup) => dup.onFile.length
  ? { bg: '#FEE2E2', fg: '#B91C1C', line: '#F87171' }
  : { bg: '#FEF9C3', fg: '#854D0E', line: '#EAB308' };

const Status = ({ r, saved, dup, decision, onCompare }: {
  r: Row; saved: boolean; dup: Dup | null; decision?: 'skip' | 'different'; onCompare: () => void;
}) => {
  if (saved) return <span style={pill('#DCFCE7', '#166534')}>Saved</span>;
  // A decided duplicate stays clickable: the status column never opens the full form, it opens the
  // comparison again so the decision can be changed.
  const compareBtn = (label: string, dupInfo: Dup) => {
    const t = dupTone(dupInfo);
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onCompare(); }} title="Compare side by side"
        style={{ ...pill(t.bg, t.fg), cursor: 'pointer', border: `0.0625rem solid ${t.line}` }}>
        {label}
      </button>
    );
  };
  // Wording (user, 2026-10-04): "records" = the system, "upload" = the
  // spreadsheet, so "file" never means both on one screen.
  if (decision === 'skip') {
    const label = dup && !dup.onFile.length && dup.inFile.length ? 'Skipped, repeated row.' : 'Skipped, already in records.';
    // Skipped goes GREY (it will not be saved) but stays clickable to change the decision.
    return dup
      ? <button type="button" onClick={(e) => { e.stopPropagation(); onCompare(); }} title="Compare side by side, or change the decision"
          style={{ ...pill('#E2E8F0', '#334155'), cursor: 'pointer', border: '0.0625rem solid #E2E8F0' }}>{label}</button>
      : <span style={pill('#E2E8F0', '#334155')}>{label}</span>;
  }
  if (r.h.readError) return <span style={pill('#FEE2E2', '#B91C1C')}>Could not read</span>;
  if (r.missing.length) return <span style={pill('#FEE2E2', '#B91C1C')}>Missing {r.missing[0].toLowerCase()}{r.missing.length > 1 ? ` +${r.missing.length - 1}` : ''}</span>;
  if (dup && decision === 'different') return compareBtn('Different child, will save', dup);
  if (dup && !decision) return compareBtn(dup.onFile.length ? 'Already in records? Compare.' : 'Repeated in this upload. Compare.', dup);
  return <span style={pill('#DCFCE7', '#166534')}>Ready</span>;
};

const Req = ({ value }: { value: string }) =>
  value ? <>{value}</> : <span style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: '0.375rem', padding: '0.0625rem 0.5rem', fontSize: '0.71875rem' }}>required</span>;

const secondaryBtn: CSSProperties = {
  cursor: 'pointer', boxSizing: 'border-box', padding: '0.6875rem 1.25rem', borderRadius: '0.625rem', fontSize: '0.875rem',
  fontWeight: 600, color: '#141413', border: `0.0625rem solid ${LINE}`, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
};
const primaryBtn: CSSProperties = {
  cursor: 'pointer', boxSizing: 'border-box', padding: '0.6875rem 1.375rem', borderRadius: '0.625rem', fontSize: '0.875rem',
  fontWeight: 700, background: NAVY, color: '#fff', border: 'none',
};
// Summary-bar legend: an item with a circled count (colour = status).
const legendItem: CSSProperties = { display: 'inline-flex', gap: '0.5rem', alignItems: 'center', fontWeight: 600 };
const legendBtn = (on: boolean): CSSProperties => ({ ...legendItem, cursor: 'pointer', background: on ? '#EEF2F8' : 'none', border: 'none', borderRadius: '62.4375rem', padding: '0.125rem 0.625rem 0.125rem 0.125rem', font: 'inherit', fontWeight: 600 });
const countDot = (bg: string): CSSProperties => ({ minWidth: '1.5rem', height: '1.5rem', borderRadius: '62.4375rem', padding: '0 0.4375rem', display: 'inline-grid', placeItems: 'center', background: bg, color: '#fff', fontSize: '0.78125rem', fontWeight: 800 });

export const BulkScanReview = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { queue?: ExtractedHandoff[]; saved?: number[]; dupDecisions?: DupDecisions } | null;
  const queue = state?.queue ?? null;
  const saved = useMemo(() => new Set(state?.saved ?? []), [state]);

  // Duplicate detection before anything is saved (2026-10-04): one server
  // request for the whole list ("already on file?"), plus "twice in this file".
  // The per-save check on the Verify page stays as the safety net.
  const [dupDecisions, setDupDecisions] = useState<DupDecisions>(state?.dupDecisions ?? {});
  const [onFile, setOnFile] = useState<DuplicateCandidate[][] | null>(null);
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  // Back asks first: leaving throws away the list that was read from the upload.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Import: ask first, show progress, and list anything the server refused.
  const toast = useToast();
  const [confirmImport, setConfirmImport] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [importFailures, setImportFailures] = useState<string[] | null>(null);
  const keyRows = useMemo(
    () => (queue ?? []).map((h) => (h.readError ? null : {
      school: h.newPatient.school, birthdate: h.newPatient.birthdate, lastName: h.newPatient.lastName, firstName: h.newPatient.firstName,
    })),
    [queue],
  );
  const inFile = useMemo(() => inFileDuplicates(keyRows), [keyRows]);
  useEffect(() => {
    if (!queue?.length) return;
    let cancelled = false;
    apiClient.post<{ matches: DuplicateCandidate[][] }>('/students/duplicate-check', {
      students: keyRows.map((k) => ({ school: k?.school ?? '', birthday: k?.birthdate ?? '', last_name: k?.lastName ?? '', first_name: k?.firstName ?? '' })),
    })
      .then((r) => { if (!cancelled) setOnFile(r.matches); })
      // A failed check hides nothing: every save is still checked by the server.
      .catch(() => { if (!cancelled) setOnFile([]); });
    return () => { cancelled = true; };
  }, [queue, keyRows]);
  const dupOf = (index: number): Dup | null => {
    const onFileHere = onFile?.[index] ?? [];
    // A twin marked "same child, skip it" will not be saved, so it no longer
    // makes this row a duplicate: skipping one copy clears the other.
    const inFileHere = (inFile.get(index) ?? []).filter((j) => dupDecisions[j] !== 'skip');
    return onFileHere.length || inFileHere.length ? { onFile: onFileHere, inFile: inFileHere } : null;
  };
  const decide = (index: number, decision: 'skip' | 'different') => {
    setDupDecisions((d) => ({ ...d, [index]: decision }));
    setCompareIndex(null);
  };
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'grid'; } catch { return 'grid'; }
  });
  const chooseView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable: the choice still holds for this visit */ }
  };
  // "Needs fixes only" is part of the state a student's form returns to, like the scroll position.
  const [onlyFixes, setOnlyFixesRaw] = useState(() => {
    try { return Array.isArray(state?.saved) && sessionStorage.getItem(FIXES_KEY) === '1'; } catch { return false; }
  });
  const setOnlyFixes = (v: boolean | ((prev: boolean) => boolean)) => setOnlyFixesRaw((prev) => {
    const next = typeof v === 'function' ? v(prev) : v;
    try { sessionStorage.setItem(FIXES_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // Ready / To check filters (user, 2026-10-07): the legend counts are buttons too. Only one
  // filter is active at a time; "Needs fixes" keeps its own remembered flag above.
  const [group, setGroup] = useState<'ready' | 'check' | null>(null);

  // The page must never scroll: only the grid does. The app's own layout puts this page
  // under a top bar and inside padding, so a fixed `100vh - N` can never be exact. Measure
  // where the page starts and give it exactly the rest of the screen, minus the layout's
  // bottom padding, so the document has nothing left to scroll.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // The corner tab (‹ ›) at the right end of the table header: it needs to know whether
  // there is more to the left or right, and whether everything already fits.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const setGrid = useCallback((el: HTMLDivElement | null) => { gridRef.current = el; setGridEl(el); }, []);
  // Phones (< 640px): the table is tall and the page scrolls, so a tab at the table's own middle
  // can sit off screen. Keep the two column arrows level with the middle of the SCREEN, but
  // always inside the table (they stay absolutely placed in the table's frame, only their top
  // moves). Wider screens keep the plain mid-height position.
  const [edgeTop, setEdgeTop] = useState<number | null>(null);
  useEffect(() => {
    const frame = gridEl?.parentElement;
    if (!frame) return;
    const place = () => {
      if (window.innerWidth >= 640) { setEdgeTop(null); return; }
      const r = frame.getBoundingClientRect();
      const mid = window.innerHeight / 2 - r.top;
      setEdgeTop(Math.round(Math.min(Math.max(mid, 56), Math.max(56, r.height - 56))));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [gridEl, view]);

  // Where the person left the table (sideways, down, and the page itself), so coming back from a
  // decision or from a student's form puts them on the same column and row. Kept for this visit
  // only, and dropped when a fresh upload starts.
  const returning = Array.isArray(state?.saved);
  const scrollMemo = useRef<{ left: number; top: number; page: number }>((() => {
    try {
      if (returning) { const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null'); if (v) return v; }
      else { sessionStorage.removeItem(SCROLL_KEY); sessionStorage.removeItem(FIXES_KEY); }
    } catch { /* storage unavailable: start at the top */ }
    return { left: 0, top: 0, page: 0 };
  })());
  useEffect(() => {
    const save = () => { try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollMemo.current)); } catch { /* ignore */ } };
    const onPage = () => { scrollMemo.current.page = window.scrollY; save(); };
    window.addEventListener('scroll', onPage, { passive: true });
    return () => window.removeEventListener('scroll', onPage);
  }, []);
  useEffect(() => {
    const el = gridEl;
    if (!el) return;
    el.scrollLeft = scrollMemo.current.left;
    el.scrollTop = scrollMemo.current.top;
    const onScroll = () => { scrollMemo.current.left = el.scrollLeft; scrollMemo.current.top = el.scrollTop; try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollMemo.current)); } catch { /* ignore */ } };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [gridEl]);
  const [tab, setTab] = useState({ left: false, right: false, fits: true, headH: 36, sbw: 0, fill: 0, rowH: 45, tail: 0 });
  // With only a few students the pane would show a big blank area. Empty rows (cells and
  // gridlines, no text) fill it down to the bottom, like a spreadsheet.
  const fillRows = (el: HTMLElement) => {
    const real = Array.from(el.querySelectorAll('tbody tr:not(.bulk-fill)')) as HTMLElement[];
    const head = (el.querySelector('thead th') as HTMLElement | null)?.offsetHeight ?? 36;
    if (real.length === 0) return { fill: 0, rowH: 45, tail: 0 };
    const realH = real.reduce((n, r) => n + r.offsetHeight, 0);
    const rowH = Math.max(24, Math.round(realH / real.length));
    // Whole empty rows, then one shorter row for what is left, so the total is exactly the
    // pane's height and no scroll bar appears for rows that are not there.
    const free = Math.max(0, el.clientHeight - head - realH - 1);
    const fill = Math.floor(free / rowH);
    return { fill, rowH, tail: free - fill * rowH };
  };
  useEffect(() => {
    const el = gridEl;
    if (!el) return;
    const update = () => {
      const th = el.querySelector('thead th') as HTMLElement | null;
      setTab({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
        fits: el.scrollWidth <= el.clientWidth + 1,
        headH: th?.offsetHeight ?? 36,
        sbw: Math.max(0, el.offsetWidth - el.clientWidth - 2),
        ...fillRows(el),
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const table = el.querySelector('table');
    if (table) ro?.observe(table);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, [gridEl]);
  // Page first, then the rows. The grid pane sticks under the top bar once it gets there; until then
  // the wheel moves the PAGE even with the pointer over the table, and when the rows are back at
  // the top a wheel up gives the page back. Sideways gestures are left alone.
  useEffect(() => {
    const el = gridEl;
    if (!el) return;
    const wrap = el.closest('.bulk-sticky') as HTMLElement | null;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (getComputedStyle(wrap).position !== 'sticky') return;
      const stuck = wrap.getBoundingClientRect().top <= TOPBAR_H + TOP_GAP + 1;
      if (!stuck || (e.deltaY < 0 && el.scrollTop <= 0)) {
        window.scrollBy(0, e.deltaY);
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gridEl]);
  // Grab and drag with the mouse to pan the table (touch screens already do this natively).
  // A drag must not count as a click on the row underneath, or it would open that student.
  useEffect(() => {
    const el = gridEl;
    if (!el) return;
    let down = false;
    let moved = false;
    let sx = 0, sy = 0, sl = 0, st = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if ((e.target as Element).closest('button, a, input, select, textarea')) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY; sl = el.scrollLeft; st = el.scrollTop;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!moved) { moved = true; el.classList.add('dragging'); }
      el.scrollLeft = sl - dx;
      el.scrollTop = st - dy;
    };
    const end = () => {
      if (!down) return;
      down = false;
      el.classList.remove('dragging');
      if (moved) {
        const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', stop, true), 0);
      }
    };
    const noSelect = (e: Event) => { if (down && moved) e.preventDefault(); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('selectstart', noSelect);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('selectstart', noSelect);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [gridEl]);
  // One press moves about a screen of columns and always lands on a column edge, so a title is
  // never sliced. The Student column is pinned, so columns scroll under it.
  const stepColumns = (dir: 1 | -1) => {
    const el = gridRef.current;
    if (!el) return;
    const ths = Array.from(el.querySelectorAll('thead th')) as HTMLElement[];
    if (ths.length < 4) return;
    const box = el.getBoundingClientRect();
    const leftOf = (t: HTMLElement) => t.getBoundingClientRect().left - box.left + el.scrollLeft;
    const pinned = ths[0].offsetWidth + ths[1].offsetWidth;
    const reserve = 28;
    const cols = ths.slice(2);
    const max = el.scrollWidth - el.clientWidth;
    if (dir === 1) {
      const viewRight = el.scrollLeft + el.clientWidth - reserve;
      const next = cols.find((c) => leftOf(c) + c.offsetWidth > viewRight + 1);
      let to = next ? leftOf(next) - pinned : max;
      // A step must always make progress, and the last one must reach the very end, so the
      // final column touches the right edge instead of stopping short of it.
      if (to <= el.scrollLeft + 1 || to > max - 8) to = max;
      el.scrollTo({ left: to, behavior: 'smooth' });
    } else {
      const target = Math.max(0, el.scrollLeft - (el.clientWidth - pinned - reserve));
      const snap = target <= 0 ? undefined : cols.find((c) => leftOf(c) - pinned >= target - 1);
      let to = snap ? leftOf(snap) - pinned : 0;
      if (to >= el.scrollLeft - 1) to = target;
      if (to < 8) to = 0;
      el.scrollTo({ left: to, behavior: 'smooth' });
    }
  };
  // The layout pads the page on the right and bottom; the grid should touch those edges, so the
  // page cancels that padding with matching negative margins.
  const [edge, setEdge] = useState({ r: 0, b: 0 });
  useLayoutEffect(() => {
    const fit = () => {
      const el = shellRef.current;
      if (!el) return;
      const parent = el.parentElement;
      const cs = parent ? getComputedStyle(parent) : null;
      const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
      // Whatever space the layout leaves BELOW this page (its own bottom padding, however many
      // wrappers it comes from) is measured, not assumed, and cancelled with a negative margin.
      // Without that the document scrolls a little past the page, the pinned table is pushed up
      // under the top bar, and a gap shows at the bottom of the screen.
      // Measured with this page's own negative margin taken off, so a stale or inflated reading
      // can never stick: each pass starts from the layout's real gap.
      const own = el.style.marginBottom;
      el.style.marginBottom = '0px';
      const below = document.documentElement.scrollHeight - (el.getBoundingClientRect().bottom + window.scrollY);
      el.style.marginBottom = own;
      setEdge((prev) => {
        const b = Math.max(0, Math.round(below));
        return prev.r === padR && prev.b === b ? prev : { r: padR, b };
      });
    };
    window.scrollTo(0, scrollMemo.current.page);
    fit();
    const raf = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (shellRef.current) ro?.observe(shellRef.current);
    ro?.observe(document.body);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, []);

  const rows: Row[] = useMemo(
    () => (queue ?? []).map((h, index) => ({ index, h, missing: h.readError ? [] : missingOf(h) })),
    [queue],
  );

  const shell: CSSProperties = {
    // The page scrolls first. The grid pane below the header then sticks under the top bar and
    // fills the rest of the screen, so from there only its rows scroll (see .bulk-sticky). The
    // shell must not clip (overflow stays visible) or the pane could not stick.
    background: '#F6F9FC', padding: '0.25rem 0 0 3.5rem', fontFamily: 'var(--font-sans)', color: '#141413',
    // width 100% + inline-size containment: a wide table inside must never widen the page
    // (an overflow:auto child still counts toward its ancestors' minimum width otherwise).
    width: `calc(100% + ${edge.r}px)`, marginRight: -edge.r, marginBottom: -edge.b, minWidth: 0, maxWidth: 'none', contain: 'inline-size', boxSizing: 'border-box', overflow: 'visible', display: 'flex', flexDirection: 'column',
  };

  // A refresh drops router state, so there is nothing to review.
  if (!queue?.length) {
    return (
      <div ref={shellRef} className="bulk-shell" style={shell}>
        <style>{'@media (max-width: 639px){.bulk-shell{height:auto !important;padding:0.25rem 1rem 1rem 1rem !important;margin-bottom:0 !important}}'}</style>
        <p style={{ fontSize: '0.875rem', color: MUTED }}>There is nothing to review. Upload the file again to start.</p>
        <button type="button" onClick={() => navigate('/students/scan?bulk=1')} style={{ ...primaryBtn, marginTop: '0.75rem' }}>Upload files</button>
      </div>
    );
  }

  const open = (index: number) =>
    navigate('/students/scan/review', { state: { queue, startIndex: index, returnTo: '/students/scan/bulk', saved: [...saved], dupDecisions } });
  const firstOpen = rows.find((r) => !saved.has(r.index) && dupDecisions[r.index] !== 'skip')?.index ?? 0;
  const unresolvedDup = (r: Row) => !saved.has(r.index) && !dupDecisions[r.index] && !!dupOf(r.index);
  const isFix = (r: Row) => !saved.has(r.index) && dupDecisions[r.index] !== 'skip'
    && (!!r.h.readError || r.missing.length > 0 || unresolvedDup(r));
  const ready = rows.filter((r) => !saved.has(r.index) && dupDecisions[r.index] !== 'skip'
    && !r.h.readError && r.missing.length === 0 && !unresolvedDup(r)).length;
  const fixes = rows.filter(isFix).length;
  const dupCount = rows.filter(unresolvedDup).length;
  const isReady = (r: Row) => !saved.has(r.index) && dupDecisions[r.index] !== 'skip'
    && !r.h.readError && r.missing.length === 0 && !unresolvedDup(r);
  const shown = onlyFixes ? rows.filter(isFix) : group === 'ready' ? rows.filter(isReady) : group === 'check' ? rows.filter(unresolvedDup) : rows;
  const showAll = () => { setOnlyFixes(false); setGroup(null); };
  const pickFilter = (g: 'ready' | 'fix' | 'check') => {
    const same = g === 'fix' ? onlyFixes : group === g;
    if (same) { showAll(); return; }
    setOnlyFixes(g === 'fix');
    setGroup(g === 'fix' ? null : g);
  };
  const filtering = onlyFixes || group !== null;

  // Everything that is ready and not skipped or already saved. Import is only offered when
  // NOTHING is left needing a fix, so a half-checked list is never saved by accident.
  const importable = () => rows.filter((r) => !saved.has(r.index) && dupDecisions[r.index] !== 'skip'
    && !r.h.readError && r.missing.length === 0 && !unresolvedDup(r));
  const skippedCount = rows.filter((r) => !saved.has(r.index) && dupDecisions[r.index] === 'skip').length;
  const canImport = fixes > 0 ? false : ready > 0 && !importing;
  const runImport = async () => {
    const todo = importable();
    setConfirmImport(false);
    setImporting({ done: 0, total: todo.length });
    let schools: ApiSchool[] = [];
    try { schools = await apiClient.get<ApiSchool[]>('/schools'); } catch { /* every row then reports the school as not found */ }
    const okIdx: number[] = [];
    const failed: string[] = [];
    for (const [n, r] of todo.entries()) {
      const f = r.h.newPatient;
      try {
        const problems = validateStudentValues({
          lastName: f.lastName, firstName: f.firstName, middleName: f.middleName,
          birthdate: f.birthdate, contactNumber: f.contactNumber, guardianContact: f.guardianContact,
        });
        if (problems.length) throw new Error(problems.join(' '));
        const school = schools.find((s) => s.school_name === f.school);
        if (!school) throw new Error('School not found.');
        const created = await apiClient.post<{ _id?: string }>('/students', {
          school_id: school._id,
          last_name: f.lastName, first_name: f.firstName, middle_name: f.middleName,
          birthday: f.birthdate, sex: f.gender, address: f.address, contact_number: f.contactNumber,
          grade_level: f.grade, section: f.section, is_not_student: f.isNotStudent,
          not_student_role: f.isNotStudent ? f.notStudentRole.trim() : '',
          place_of_birth: f.placeOfBirth, guardian_name: f.guardianName, guardian_contact: f.guardianContact,
          guardian_occupation: f.guardianOccupation, philhealth_number: f.philhealthNumber,
          philhealth_status: f.philhealthNumber.trim() ? f.philhealthStatus : 'None',
          is_4ps: f.is4Ps, fourps_id: f.fourPsId,
          ...(dupDecisions[r.index] === 'different' ? { confirm_duplicate: true } : {}),
        });
        if (created?._id) {
          try {
            await apiClient.post('/student-iptrs', {
              student_id: created._id, school_year: schoolYearLabel(),
              grade_level: f.isNotStudent ? null : f.grade, section: f.isNotStudent ? null : f.section,
              consent_status: f.consentStatus,
            });
          } catch { /* best-effort: the chart's own "Add Year" still works */ }
        }
        okIdx.push(r.index);
      } catch (err) {
        failed.push(`${fullName(r.h, r.index)}: ${err instanceof ApiError || err instanceof Error ? err.message : 'could not be saved.'}`);
      }
      setImporting({ done: n + 1, total: todo.length });
    }
    setImporting(null);
    if (okIdx.length) navigate(location.pathname, { replace: true, state: { ...state, saved: [...saved, ...okIdx], dupDecisions } });
    if (failed.length) {
      setImportFailures(failed);
      if (okIdx.length) toast.success(`${okIdx.length} student${okIdx.length === 1 ? '' : 's'} imported.`);
    } else {
      toast.success(`${okIdx.length} student${okIdx.length === 1 ? '' : 's'} imported.`);
      navigate('/patients');
    }
  };

  const openBtn = (r: Row) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); open(r.index); }}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: '#fff', color: NAVY, border: `0.0625rem solid ${NAVY}`, borderRadius: '62.4375rem', padding: '0.1875rem 0.75rem', fontSize: '0.75rem', fontWeight: 700 }}
    >
      Open full form
    </button>
  );

  const cols: { label: string; cell: (r: Row) => ReactNode }[] = [
    { label: 'Birthdate', cell: (r) => <Req value={r.h.newPatient.birthdate} /> },
    { label: 'Age', cell: (r) => calculateAge(r.h.newPatient.birthdate) ?? '' },
    { label: 'Sex', cell: (r) => <Req value={r.h.newPatient.gender} /> },
    { label: 'Grade', cell: (r) => <Req value={r.h.newPatient.grade} /> },
    { label: 'Section', cell: (r) => <Req value={r.h.newPatient.section} /> },
    { label: 'Place of Birth', cell: (r) => r.h.newPatient.placeOfBirth },
    { label: 'Contact Number', cell: (r) => r.h.newPatient.contactNumber },
    { label: 'Guardian Name', cell: (r) => r.h.newPatient.guardianName },
    { label: 'Guardian Contact', cell: (r) => r.h.newPatient.guardianContact },
    { label: 'Occupation', cell: (r) => r.h.newPatient.guardianOccupation },
    { label: 'PhilHealth Number', cell: (r) => r.h.newPatient.philhealthNumber },
    { label: 'PhilHealth Status', cell: (r) => r.h.newPatient.philhealthStatus },
    { label: 'Address', cell: (r) => r.h.newPatient.address },
    { label: 'Status', cell: (r) => <Status r={r} saved={saved.has(r.index)} dup={dupOf(r.index)} decision={dupDecisions[r.index]} onCompare={() => setCompareIndex(r.index)} /> },
    { label: 'Form', cell: (r) => openBtn(r) },
  ];

  // Excel look in the app's blue: navy header row, light-blue frozen Student column,
  // thin gridlines on every cell, softly banded rows.
  const head: CSSProperties = {
    position: 'sticky', top: 0, zIndex: 3, background: NAVY, color: '#fff', textAlign: 'left', whiteSpace: 'nowrap',
    padding: '0.5625rem 0.75rem', fontSize: '0.78125rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    borderRight: '0.0625rem solid rgba(255,255,255,0.18)', borderBottom: `0.0625rem solid ${NAVY}`,
  };
  const cell: CSSProperties = {
    whiteSpace: 'nowrap', padding: '0.5rem 0.75rem', fontSize: '0.8125rem', borderRight: `0.0625rem solid ${GRID_LINE}`, borderBottom: `0.0625rem solid ${GRID_LINE}`,
  };

  return (
    <div ref={shellRef} className="bulk-shell" style={shell}>
      {/* Scrolling still works (wheel, trackpad, touch, arrow keys); only the bars are hidden.
          Phones (< 640 px, 2026-10-04): the screen-height pane left the list a thin
          strip under the header, and the inline 3.5rem left padding pushed the page
          right. There, the page scrolls normally, the list pane is capped at 75% of
          the screen, and the side padding is 1rem. Wider screens unchanged. */}
      <style>{'.bulk-scroll{scrollbar-width:none;-ms-overflow-style:none}.bulk-scroll::-webkit-scrollbar{display:none;width:0;height:0}'
        // No scroll bars at all on the table (user, 2026-10-05): wheel, trackpad, dragging and the edge tabs still move it.
        + '.bulk-grid{cursor:grab}.bulk-grid.dragging{cursor:grabbing;user-select:none}'
        // Slim tabs on the left and right edges of the table, at mid height (user pick 4, 2026-10-05).
        + '.bulk-edge{position:absolute;top:50%;transform:translateY(-50%);width:1.25rem;height:2.875rem;border:0;background:#273A78;color:#fff;font-size:1rem;font-weight:700;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0;opacity:.92;z-index:6;box-shadow:0 0.125rem 0.5rem rgba(15,23,42,0.25)}'
        + '.bulk-edge.l{left:0.0625rem;border-radius:0 0.5625rem 0.5625rem 0}.bulk-edge.r{border-radius:0.5625rem 0 0 0.5625rem}'
        + '.bulk-edge:hover:not(:disabled){background:#31458C;opacity:1}.bulk-edge:active:not(:disabled){background:#101A3D}'
        + '.bulk-edge:disabled{opacity:.3;cursor:default}.bulk-edge:focus-visible{outline:0.125rem solid #7AA2FF;outline-offset:0.125rem}'
        + '@media (pointer: coarse){.bulk-edge{width:2rem;height:3.5rem}}'
        + '@media (max-width: 639px){.bulk-shell{height:auto !important;overflow:visible !important;padding:0.25rem 0 1rem 1rem !important;margin-bottom:0 !important}'
        + '.bulk-head{gap:0.75rem !important}.bulk-head>div:first-child{display:none !important}.bulk-head>div:nth-child(2){flex:1 1 0 !important}.bulk-head h1{font-size:1.375rem !important}'
        + '.bulk-bar{padding:1rem !important;gap:0.875rem !important}.bulk-bar-left{flex:1 1 100% !important;width:100%}.bulk-bar-left>div{max-width:none !important}'
        + '.bulk-bar-right{margin-left:0 !important;width:100%;align-items:stretch !important}.bulk-view{display:flex !important}.bulk-view button{flex:1;justify-content:center}'
        + '.bulk-actions{flex-direction:column !important;width:100%}.bulk-actions button{width:100%;justify-content:center}'
        + '.bulk-pr{padding-right:1rem !important}.bulk-scroll{flex:none !important;max-height:75vh}.bulk-sticky{position:static !important;height:auto !important}}'}</style>
      {/* Header, same shape as the Scan and Verify pages */}
      <div className="bulk-pr bulk-head" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', flexShrink: 0, paddingRight: '3.5rem' }}>
        <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '1rem', background: '#F4F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="23.8" height="23.8" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
        </div>
        <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Students &middot; OCR &middot; Bulk upload</div>
          <h1 style={{ margin: '0.125rem 0 0', fontSize: '1.625rem', fontWeight: 700 }}>Review Imported Students</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: MUTED }}>
            {rows.length} student{rows.length === 1 ? '' : 's'} found. Nothing is saved until you import them or open each form and confirm it.{fixes > 0 && <b style={{ color: '#B91C1C', fontWeight: 600 }}> Fix {fixes} student{fixes === 1 ? '' : 's'} before importing.</b>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setConfirmLeave(true)} style={secondaryBtn}>
            <svg width="12.8" height="12.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            Back
          </button>
        </div>
      </div>

      {/* The summary bar (user pick B of the layouts, 2026-10-07): the sentence, one progress bar
          split by status and its legend, all centred, on the left; on the right the Grid / Cards
          switch sits above Review one by one and Import. Back stays in the header, top right.
          Only "Needs fixes" filters the list (the other counts are plain). */}
      <div className="bulk-pr" style={{ flexShrink: 0, paddingRight: '3.5rem', marginBottom: '0.75rem' }}>
      <div className="bulk-bar" style={{ display: 'flex', gap: '1.125rem', flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: `0.0625rem solid ${LINE}`, borderRadius: '1rem', padding: '1.5rem 1.5rem' }}>
        <div className="bulk-bar-left" style={{ flex: '1 1 22rem', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 0 }}>
        <div style={{ width: '100%', maxWidth: '44rem', textAlign: 'left' }}>
          <b style={{ fontSize: '1.0625rem' }}>{ready} of {rows.length} student{rows.length === 1 ? ' is' : 's are'} ready</b>
          <div role="img" aria-label={`${ready} ready, ${fixes} need fixes, ${saved.size} saved`} style={{ display: 'flex', height: '1rem', borderRadius: '62.4375rem', overflow: 'hidden', background: '#E8EDF6', margin: '0.875rem 0 0.75rem' }}>
            <span style={{ width: `${rows.length ? (ready / rows.length) * 100 : 0}%`, background: '#16A34A' }} />
            <span style={{ width: `${rows.length ? (saved.size / rows.length) * 100 : 0}%`, background: '#2563EB' }} />
            <span style={{ width: `${rows.length ? (fixes / rows.length) * 100 : 0}%`, background: '#DC2626' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.375rem 1.125rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8125rem' }}>
            <button type="button" onClick={() => pickFilter('ready')} aria-pressed={group === 'ready'} title={group === 'ready' ? 'Show all students' : 'Show only the students who are ready'} style={legendBtn(group === 'ready')}><span style={countDot('#16A34A')}>{ready}</span>Ready</button>
            {saved.size > 0 && <span style={legendItem}><span style={countDot('#2563EB')}>{saved.size}</span>Saved</span>}
            <button type="button" onClick={() => pickFilter('fix')} aria-pressed={onlyFixes} title={onlyFixes ? 'Show all students' : 'Show only the students who need fixes'} style={legendBtn(onlyFixes)}><span style={countDot('#DC2626')}>{fixes}</span>Needs fixes</button>
            {onFile === null
              ? <span style={{ color: MUTED }}>Checking for duplicates…</span>
              : dupCount > 0 && <button type="button" onClick={() => pickFilter('check')} aria-pressed={group === 'check'} title={group === 'check' ? 'Show all students' : 'Show only the students to check'} style={legendBtn(group === 'check')}><span style={countDot('#F59E0B')}>{dupCount}</span>To check</button>}
            <button type="button" onClick={showAll} aria-pressed={!filtering} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: NAVY, textDecoration: 'underline', textUnderlineOffset: '0.25rem' }}>
              Show all {rows.length}
            </button>
          </div>
        </div>
        </div>
        <div className="bulk-bar-right" style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.625rem' }}>
          <div className="bulk-view" style={{ display: 'inline-flex', gap: '0.125rem', background: '#EEF2F8', borderRadius: '0.75rem', padding: '0.1875rem' }} role="group" aria-label="View">
            {(['grid', 'cards'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => chooseView(v)}
                aria-pressed={view === v}
                aria-label={v === 'grid' ? 'Grid view' : 'Cards view'}
                title={v === 'grid' ? 'Grid view' : 'Cards view'}
                style={{ cursor: 'pointer', border: 'none', borderRadius: '0.5625rem', padding: '0.4375rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.4375rem', fontWeight: 700, fontSize: '0.8125rem', background: view === v ? '#fff' : 'transparent', color: view === v ? NAVY : '#475569', boxShadow: view === v ? '0 0.0625rem 0.25rem rgba(15,27,61,0.15)' : 'none' }}
              >
                {v === 'grid' ? <Table2 size={17} /> : <LayoutGrid size={17} />}
                {v === 'grid' ? 'Grid' : 'Cards'}
              </button>
            ))}
          </div>
          <div className="bulk-actions" style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => open(firstOpen)} disabled={!!importing} style={{ ...secondaryBtn, background: '#DC2626', borderColor: '#DC2626', color: '#fff', fontWeight: 700 }}>Review one by one</button>
            <button
              type="button"
              onClick={() => setConfirmImport(true)}
              disabled={!canImport}
              title={fixes > 0 ? `Fix ${fixes} student${fixes === 1 ? '' : 's'} first (see the "need fixes" count)` : ready === 0 ? 'Nothing left to import' : undefined}
              style={{ ...primaryBtn, ...(canImport ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }}
            >
              {importing ? `Importing ${importing.done} of ${importing.total}...` : `Import ${ready} student${ready === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
      </div>

      {shown.length === 0 && (
        // The "needs fixes" filter is on and nothing matches: say why, say it is good news, and
        // give the way back (same card shape as the Students list's empty states).
        <div style={{ margin: '2.5rem auto', maxWidth: '28rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', textAlign: 'center' }}>
          <span style={{ width: '3.5rem', height: '3.5rem', borderRadius: '50%', background: '#DCFCE7', color: '#15803D', display: 'grid', placeItems: 'center' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700 }}>{group === 'ready' ? 'No students are ready yet' : group === 'check' ? 'No students to check' : 'No students need fixes'}</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: MUTED, lineHeight: 1.5 }}>
            {group === 'ready' ? 'Students become ready once their details are complete. Show all students to see what is left.' : group === 'check' ? 'No student in this upload looks like a duplicate. Show all students to open each form and confirm it.' : 'Every student in this upload has the required details. Show all students to open each form and confirm it.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem' }}>
            <span style={{ border: `0.0625rem solid ${LINE}`, background: '#fff', borderRadius: '999px', padding: '0.1875rem 0.75rem', fontSize: '0.75rem' }}>Showing: {group === 'ready' ? 'Ready' : group === 'check' ? 'To check' : 'Needs fixes'}</span>
          </div>
          <button type="button" onClick={showAll} style={{ ...primaryBtn, padding: '0.5rem 1.125rem', fontSize: '0.8125rem' }}>Show all students</button>
        </div>
      )}

      {shown.length > 0 && view === 'grid' && (
        // The pane fills the screen below the header (the page itself does not scroll), so the
        // column titles stay pinned and only the rows scroll down (user, 2026-10-05). It also
        // scrolls sideways, by bar, by the corner tab, or by grabbing and dragging. The Student
        // column stays pinned on the left.
        <div className="bulk-pr bulk-sticky" style={{ position: 'sticky', top: TOPBAR_H + TOP_GAP, height: `calc(100vh - ${TOPBAR_H + TOP_GAP}px)`, width: '100%', boxSizing: 'border-box', paddingRight: '3.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={setGrid} className="bulk-scroll bulk-grid" style={{ flex: '1 1 0', minHeight: 0, width: 0, minWidth: '100%', maxWidth: '100%', overflow: 'auto', background: '#fff', border: `0.0625rem solid ${GRID_LINE}`, borderBottom: 'none', borderRadius: '0.75rem 0.75rem 0 0' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...head, left: 0, zIndex: 6, width: NUM_W, minWidth: NUM_W, padding: '0 0.25rem', textAlign: 'center' }} title="Row in the upload">#</th>
                <th style={{ ...head, left: NUM_W, zIndex: 5 }}>Student</th>
                {cols.map((c, ci) => <th key={c.label} style={ci === cols.length - 1 ? { ...head, paddingRight: LAST_COL_PAD } : head}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const band = i % 2 ? '#F5F8FF' : '#fff';
                return (
                  <tr key={r.index} onClick={() => open(r.index)} style={{ cursor: 'pointer', background: band }}>
                    <td style={{ ...cell, position: 'sticky', left: 0, zIndex: 3, background: '#E8EEFB', color: MUTED, fontVariantNumeric: 'tabular-nums', width: NUM_W, minWidth: NUM_W, padding: '0 0.25rem', textAlign: 'center', fontSize: '0.6875rem' }}>{r.index + 1}</td>
                    <td style={{ ...cell, position: 'sticky', left: NUM_W, zIndex: 2, background: '#E8EEFB', fontWeight: 700, color: NAVY, boxShadow: `1px 0 0 ${GRID_LINE}` }}>{fullName(r.h, r.index)}</td>
                    {cols.map((c, ci) => <td key={c.label} onClick={c.label === 'Status' ? (e) => e.stopPropagation() : undefined} style={ci === cols.length - 1 ? { ...cell, paddingRight: LAST_COL_PAD } : cell}>{c.cell(r)}</td>)}
                  </tr>
                );
              })}
              {Array.from({ length: tab.fill + (tab.tail > 2 ? 1 : 0) }, (_, k) => {
                const band = (shown.length + k) % 2 ? '#F5F8FF' : '#fff';
                return (
                  <tr key={`fill-${k}`} className="bulk-fill" aria-hidden="true" style={{ background: band, height: k < tab.fill ? tab.rowH : tab.tail }}>
                    <td style={{ ...cell, position: 'sticky', left: 0, zIndex: 3, background: '#E8EEFB', width: NUM_W, minWidth: NUM_W }} />
                    <td style={{ ...cell, position: 'sticky', left: NUM_W, zIndex: 2, background: '#E8EEFB', boxShadow: `1px 0 0 ${GRID_LINE}` }} />
                    {cols.map((c) => <td key={c.label} style={cell} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          {!tab.fits && (
            <>
              <button type="button" className="bulk-edge l" style={edgeTop === null ? undefined : { top: edgeTop }} aria-label="Show previous columns" title="Show previous columns" disabled={!tab.left} onClick={() => stepColumns(-1)}>‹</button>
              <button type="button" className="bulk-edge r" style={{ right: `calc(0.0625rem + ${tab.sbw}px)`, ...(edgeTop === null ? {} : { top: edgeTop }) }} aria-label="Show next columns" title="Show next columns" disabled={!tab.right} onClick={() => stepColumns(1)}>›</button>
            </>
          )}
        </div>
        </div>
      )}

      {shown.length > 0 && view === 'cards' && (
        <div className="bulk-scroll bulk-pr" style={{ flex: 'none', width: 0, minWidth: '100%', overflow: 'visible', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1rem', alignContent: 'start', paddingRight: '3.5rem', paddingBottom: '1rem' }}>
          {shown.map((r) => {
            const p = r.h.newPatient;
            return (
              <div key={r.index} style={{ background: '#fff', border: `${isFix(r) ? '0.09375rem' : '0.0625rem'} solid ${isFix(r) ? '#F87171' : LINE}`, borderRadius: '1rem', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.625rem' }}>
                  <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(r.h, r.index)}</h2>
                  <Status r={r} saved={saved.has(r.index)} dup={dupOf(r.index)} decision={dupDecisions[r.index]} onCompare={() => setCompareIndex(r.index)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '5.25rem 1fr', gap: '0.1875rem 0.5rem', fontSize: '0.8125rem' }}>
                  <span style={{ color: MUTED }}>Grade</span><span><Req value={p.grade} /></span>
                  <span style={{ color: MUTED }}>Section</span><span><Req value={p.section} /></span>
                  <span style={{ color: MUTED }}>Sex</span><span><Req value={p.gender} /></span>
                  <span style={{ color: MUTED }}>Birthdate</span><span><Req value={p.birthdate} /></span>
                  <span style={{ color: MUTED }}>Guardian</span><span>{p.guardianName}</span>
                </div>
                {r.h.readError && <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#B91C1C' }}>{r.h.readError}</p>}
                <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>{openBtn(r)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Side by side, like the offline conflict review: the row from the file next
          to the record it may duplicate, then a decision that Save & Next honours. */}
      {confirmImport && (
        <div role="dialog" aria-modal="true" aria-label="Import students" onClick={() => setConfirmImport(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: '100%', maxWidth: '28rem', boxSizing: 'border-box' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Import {ready} student{ready === 1 ? '' : 's'}?</h2>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: MUTED, lineHeight: 1.5 }}>
              Each one is saved to the student records and gets a {schoolYearLabel()} record. {skippedCount > 0 ? `${skippedCount} marked "same child, skip it" will not be saved. ` : ''}You can still open any student afterwards to complete their chart.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '1.125rem' }}>
              <button type="button" onClick={() => setConfirmImport(false)} style={secondaryBtn}>Cancel</button>
              <button type="button" onClick={() => void runImport()} style={primaryBtn}>Import</button>
            </div>
          </div>
        </div>
      )}
      {importFailures && (
        <div role="dialog" aria-modal="true" aria-label="Some students were not imported" onClick={() => setImportFailures(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: '100%', maxWidth: '34rem', maxHeight: '90vh', overflow: 'auto', boxSizing: 'border-box' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>{importFailures.length} student{importFailures.length === 1 ? ' was' : 's were'} not imported</h2>
            <p style={{ margin: '0.5rem 0 0.75rem', fontSize: '0.875rem', color: MUTED }}>The others were saved. Open these to correct them, then import again.</p>
            <ul style={{ margin: 0, paddingLeft: '1.125rem', fontSize: '0.8125rem', lineHeight: 1.6 }}>
              {importFailures.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.125rem' }}>
              <button type="button" onClick={() => setImportFailures(null)} style={primaryBtn}>Close</button>
            </div>
          </div>
        </div>
      )}
      {confirmLeave && (
        <div role="dialog" aria-modal="true" aria-label="Leave this review" onClick={() => setConfirmLeave(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: '100%', maxWidth: '26rem', boxSizing: 'border-box' }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Leave this review?</h2>
            <p style={{ margin: '0.5rem 0 1.125rem', fontSize: '0.875rem', color: MUTED, lineHeight: 1.5 }}>
              The {rows.length} student{rows.length === 1 ? '' : 's'} read from this upload have not been saved. If you go back, this list is discarded and you will need to upload the file again.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setConfirmLeave(false)} style={secondaryBtn}>Stay</button>
              <button type="button" onClick={() => navigate('/students/scan?bulk=1')} style={{ ...primaryBtn, background: '#C8102E' }}>Leave and discard</button>
            </div>
          </div>
        </div>
      )}
      {compareIndex !== null && queue[compareIndex] && (() => {
        const p = queue[compareIndex].newPatient;
        const d = dupOf(compareIndex);
        const existing = d?.onFile[0];
        const otherRow = d?.inFile.length ? queue[d.inFile[0]].newPatient : null;
        // Panels are tinted by where the other copy is: light red = already in the student records,
        // light yellow = repeated in this same upload.
        const side = (title: string, lines: [string, string][], note?: string, tint?: { bg: string; line: string }) => (
          <div style={{ flex: '1 1 14rem', minWidth: 0, border: `0.0625rem solid ${tint?.line ?? LINE}`, background: tint?.bg ?? '#fff', borderRadius: '0.75rem', padding: '0.875rem' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: '0.5rem' }}>{title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '5.5rem 1fr', gap: '0.25rem 0.5rem', fontSize: '0.8125rem' }}>
              {lines.map(([k, v]) => <Fragment key={k}><span style={{ color: MUTED }}>{k}</span><span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{v || '(blank)'}</span></Fragment>)}
            </div>
            {note && <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: MUTED }}>{note}</p>}
          </div>
        );
        return (
          <div role="dialog" aria-modal="true" aria-label="Compare possible duplicate" onClick={() => setCompareIndex(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: '100%', maxWidth: existing && otherRow ? '62rem' : '44rem', maxHeight: '90vh', overflow: 'auto', boxSizing: 'border-box' }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Is this the same child?</h2>
              <p style={{ margin: '0.25rem 0 1rem', fontSize: '0.8125rem', color: MUTED }}>
                Same school, same birthday and same name. {existing ? 'This child is already in the student records' : ''}{existing && otherRow ? ' and appears again in this upload' : ''}{existing ? '. ' : ''}Check the details before saving.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {side('From the upload', [
                  ['Name', [p.lastName, p.firstName].filter(Boolean).join(', ') + (p.middleName ? ` ${p.middleName}` : '')],
                  ['Birthdate', p.birthdate], ['Sex', p.gender], ['Grade', [p.grade, p.section].filter(Boolean).join(' ')], ['School', p.school],
                ])}
                {existing && side('Already in student records', [
                  ['Name', existing.full_name], ['Birthdate', String(existing.birthday ?? '').slice(0, 10)], ['Sex', existing.sex],
                  ['Grade', [existing.grade_level, existing.section].filter(Boolean).join(' ')], ['School', p.school],
                ], d && d.onFile.length > 1 ? `${d.onFile.length - 1} more record(s) in the system also match.` : undefined, { bg: '#FEE2E2', line: '#F87171' })}
                {otherRow && side(`Also in this upload (row ${(d?.inFile[0] ?? 0) + 1})`, [
                  ['Name', [otherRow.lastName, otherRow.firstName].filter(Boolean).join(', ') + (otherRow.middleName ? ` ${otherRow.middleName}` : '')],
                  ['Birthdate', otherRow.birthdate], ['Sex', otherRow.gender], ['Grade', [otherRow.grade, otherRow.section].filter(Boolean).join(' ')], ['School', otherRow.school],
                ], undefined, { bg: '#FEF9C3', line: '#EAB308' })}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '1.125rem' }}>
                <button type="button" onClick={() => setCompareIndex(null)} style={secondaryBtn}>Cancel</button>
                <button type="button" onClick={() => { const i = compareIndex; setCompareIndex(null); open(i); }} style={secondaryBtn}>Edit this row</button>
                <button type="button" onClick={() => decide(compareIndex, 'different')} style={secondaryBtn}>Different child, save anyway</button>
                <button type="button" onClick={() => decide(compareIndex, 'skip')} style={primaryBtn}>Same child, skip it</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
