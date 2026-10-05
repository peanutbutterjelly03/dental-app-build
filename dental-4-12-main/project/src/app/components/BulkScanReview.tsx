import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { REQUIRED_STUDENT_FIELDS, type DuplicateCandidate } from './PatientList';
import type { ExtractedHandoff } from './ScanStudentForm';
import { calculateAge } from '../utils/age';
import { apiClient } from '../api/client';
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
type View = 'grid' | 'cards';

type Row = { index: number; h: ExtractedHandoff; missing: string[] };

const NAVY = '#273A78';
const MUTED = '#67687A';
const LINE = '#E2E8F0';
const GRID_LINE = '#CBD5E1';
// The last column keeps this much room on its right so its title ends before the corner tab.
const LAST_COL_PAD = '6rem';

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

const Status = ({ r, saved, dup, decision, onCompare }: {
  r: Row; saved: boolean; dup: Dup | null; decision?: 'skip' | 'different'; onCompare: () => void;
}) => {
  if (saved) return <span style={pill('#DCFCE7', '#166534')}>Saved</span>;
  // Wording (user, 2026-10-04): "records" = the system, "upload" = the
  // spreadsheet, so "file" never means both on one screen.
  if (decision === 'skip') {
    return <span style={pill('#F1F5F9', '#475569')}>{dup && !dup.onFile.length && dup.inFile.length ? 'Skipped: repeated row' : 'Skipped: already in records'}</span>;
  }
  if (r.h.readError) return <span style={pill('#FEE2E2', '#B91C1C')}>Could not read</span>;
  if (r.missing.length) return <span style={pill('#FEE2E2', '#B91C1C')}>Missing {r.missing[0].toLowerCase()}{r.missing.length > 1 ? ` +${r.missing.length - 1}` : ''}</span>;
  if (dup && !decision) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onCompare(); }} title="Compare side by side"
        style={{ ...pill('#FEF3C7', '#92400E'), cursor: 'pointer', border: '0.0625rem solid #F59E0B' }}>
        {dup.onFile.length ? 'Already in records? Compare' : 'Repeated in this upload. Compare'}
      </button>
    );
  }
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
const chip: CSSProperties = {
  background: '#fff', border: `0.0625rem solid ${LINE}`, borderRadius: '62.4375rem', padding: '0.3125rem 0.875rem', fontSize: '0.8125rem',
};

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
  const [onlyFixes, setOnlyFixes] = useState(false);

  // The page must never scroll: only the grid does. The app's own layout puts this page
  // under a top bar and inside padding, so a fixed `100vh - N` can never be exact. Measure
  // where the page starts and give it exactly the rest of the screen, minus the layout's
  // bottom padding, so the document has nothing left to scroll.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // The corner tab (‹ ›) at the right end of the table header: it needs to know whether
  // there is more to the left or right, and whether everything already fits.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const setGrid = (el: HTMLDivElement | null) => { gridRef.current = el; setGridEl(el); };
  const [tab, setTab] = useState({ left: false, right: false, fits: true, headH: 36, sbw: 0 });
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
    if (ths.length < 3) return;
    const box = el.getBoundingClientRect();
    const leftOf = (t: HTMLElement) => t.getBoundingClientRect().left - box.left + el.scrollLeft;
    const pinned = ths[0].offsetWidth;
    const reserve = (el.parentElement?.querySelector('.bulk-tab') as HTMLElement | null)?.offsetWidth ?? 80;
    const cols = ths.slice(1);
    if (dir === 1) {
      const viewRight = el.scrollLeft + el.clientWidth - reserve;
      const next = cols.find((c) => leftOf(c) + c.offsetWidth > viewRight + 1);
      el.scrollTo({ left: next ? leftOf(next) - pinned : el.scrollWidth, behavior: 'smooth' });
    } else {
      const target = Math.max(0, el.scrollLeft - (el.clientWidth - pinned - reserve));
      const snap = target <= 0 ? undefined : cols.find((c) => leftOf(c) - pinned >= target - 1);
      el.scrollTo({ left: snap ? leftOf(snap) - pinned : 0, behavior: 'smooth' });
    }
  };
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  // The layout pads the page on the right and bottom; the grid should touch those edges, so the
  // page cancels that padding with matching negative margins.
  const [edge, setEdge] = useState({ r: 0, b: 0 });
  useLayoutEffect(() => {
    const fit = () => {
      const el = shellRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const parent = el.parentElement;
      const cs = parent ? getComputedStyle(parent) : null;
      const padB = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
      const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
      setEdge({ r: padR, b: padB });
      setFitHeight(Math.max(240, Math.floor(window.innerHeight - top)));
    };
    window.scrollTo(0, 0);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const rows: Row[] = useMemo(
    () => (queue ?? []).map((h, index) => ({ index, h, missing: h.readError ? [] : missingOf(h) })),
    [queue],
  );

  const shell: CSSProperties = {
    // The PAGE never scrolls: it is exactly the screen below the top bar, and only the
    // grid (or the cards) inside it scrolls, both ways, like a spreadsheet pane.
    background: '#F6F9FC', height: fitHeight ?? 'calc(100vh - 8rem)', padding: '0.25rem 0 0 3.5rem', fontFamily: 'var(--font-sans)', color: '#141413',
    // width 100% + inline-size containment: a wide table inside must never widen the page
    // (an overflow:auto child still counts toward its ancestors' minimum width otherwise).
    width: `calc(100% + ${edge.r}px)`, marginRight: -edge.r, marginBottom: -edge.b, minWidth: 0, maxWidth: 'none', contain: 'inline-size', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column',
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
  const shown = onlyFixes ? rows.filter(isFix) : rows;

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
      <style>{'.bulk-scroll{scrollbar-width:thin;scrollbar-color:#9aa5c0 #eef1f7}'
        + '.bulk-grid{cursor:grab}.bulk-grid.dragging{cursor:grabbing;user-select:none}'
        + '.bulk-tab{position:absolute;top:0.0625rem;right:0.0625rem;display:flex;align-items:center;gap:0.25rem;padding:0 0.5rem;background:#273A78;border-left:0.0625rem solid rgba(255,255,255,0.18);border-top-right-radius:0.6875rem;z-index:6}'
        + '.bulk-tab button{width:1.75rem;height:1.75rem;border:0.0625rem solid rgba(255,255,255,0.45);border-radius:0.5rem;background:rgba(255,255,255,0.16);color:#fff;font-size:1.0625rem;font-weight:700;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}'
        + '.bulk-tab button:hover:not(:disabled){background:rgba(255,255,255,0.32)}.bulk-tab button:active:not(:disabled){background:rgba(255,255,255,0.45)}'
        + '.bulk-tab button:disabled{opacity:.4;cursor:default}.bulk-tab button:focus-visible{outline:0.125rem solid #7AA2FF;outline-offset:0.125rem}'
        + '@media (pointer: coarse){.bulk-tab button{width:2.75rem;height:2.75rem}}'
        + '@media (max-width: 639px){.bulk-shell{height:auto !important;overflow:visible !important;padding:0.25rem 0 1rem 1rem !important;margin-bottom:0 !important}'
        + '.bulk-pr{padding-right:1rem !important}.bulk-scroll{flex:none !important;max-height:75vh}}'}</style>
      {/* Header, same shape as the Scan and Verify pages */}
      <div className="bulk-pr" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', flexShrink: 0, paddingRight: '3.5rem' }}>
        <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '1rem', background: '#F4F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="23.8" height="23.8" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
        </div>
        <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Students &middot; OCR &middot; Bulk upload</div>
          <h1 style={{ margin: '0.125rem 0 0', fontSize: '1.625rem', fontWeight: 700 }}>Review Imported Students</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: MUTED }}>
            {rows.length} student{rows.length === 1 ? '' : 's'} found. Nothing is saved until you open each form and confirm it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => open(firstOpen)} style={primaryBtn}>Review one by one</button>
          <button type="button" onClick={() => setConfirmLeave(true)} style={secondaryBtn}>
            <svg width="12.8" height="12.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            Back
          </button>
        </div>
      </div>

      {/* Summary, filter and the Grid / Cards switch sit directly above the list */}
      <div className="bulk-pr" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', flexShrink: 0, paddingRight: '3.5rem' }}>
        <span style={chip}><b>{rows.length}</b> found</span>
        <span style={chip}><b style={{ color: '#15803D' }}>{ready}</b> ready</span>
        <span style={chip}><b style={{ color: '#B91C1C' }}>{fixes}</b> need fixes</span>
        {onFile === null
          ? <span style={{ ...chip, color: MUTED }}>Checking for duplicates…</span>
          : dupCount > 0 && <span style={{ ...chip, borderColor: '#F59E0B' }}><b style={{ color: '#92400E' }}>{dupCount}</b> to check</span>}
        {saved.size > 0 && <span style={chip}><b style={{ color: '#15803D' }}>{saved.size}</b> saved</span>}
        <button type="button" onClick={() => setOnlyFixes((v) => !v)} aria-pressed={onlyFixes} style={{ ...secondaryBtn, padding: '0.3125rem 0.875rem', fontSize: '0.8125rem' }}>
          {onlyFixes ? 'Show all students' : 'Show only: Needs fixes'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', overflow: 'hidden', borderRadius: '0.625rem', border: `0.0625rem solid ${LINE}`, background: '#fff' }} role="group" aria-label="View">
          {(['grid', 'cards'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => chooseView(v)}
              aria-pressed={view === v}
              aria-label={v === 'grid' ? 'Grid view' : 'Cards view'}
              title={v === 'grid' ? 'Grid view' : 'Cards view'}
              style={{ cursor: 'pointer', border: 'none', padding: '0.5rem 0.875rem', display: 'inline-flex', alignItems: 'center', background: view === v ? NAVY : '#fff', color: view === v ? '#fff' : '#141413' }}
            >
              {v === 'grid' ? <Table2 size={18} /> : <LayoutGrid size={18} />}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <p style={{ fontSize: '0.875rem', color: MUTED, flexShrink: 0 }}>No student needs fixes.</p>}

      {shown.length > 0 && view === 'grid' && (
        // The pane fills the screen below the header (the page itself does not scroll), so the
        // column titles stay pinned and only the rows scroll down (user, 2026-10-05). It also
        // scrolls sideways, by bar, by the corner tab, or by grabbing and dragging. The Student
        // column stays pinned on the left.
        <div className="bulk-pr" style={{ position: 'relative', width: '100%', boxSizing: 'border-box', paddingRight: '3.5rem', flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={setGrid} className="bulk-scroll bulk-grid" style={{ flex: '1 1 0', minHeight: 0, width: 0, minWidth: '100%', maxWidth: '100%', overflow: 'auto', background: '#fff', border: `0.0625rem solid ${GRID_LINE}`, borderRadius: '0.75rem' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...head, left: 0, zIndex: 5 }}>Student</th>
                {cols.map((c, ci) => <th key={c.label} style={ci === cols.length - 1 ? { ...head, paddingRight: LAST_COL_PAD } : head}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const band = i % 2 ? '#F5F8FF' : '#fff';
                return (
                  <tr key={r.index} onClick={() => open(r.index)} style={{ cursor: 'pointer', background: band }}>
                    <td style={{ ...cell, position: 'sticky', left: 0, zIndex: 2, background: '#E8EEFB', fontWeight: 700, color: NAVY, boxShadow: `1px 0 0 ${GRID_LINE}` }}>{fullName(r.h, r.index)}</td>
                    {cols.map((c, ci) => <td key={c.label} style={ci === cols.length - 1 ? { ...cell, paddingRight: LAST_COL_PAD } : cell}>{c.cell(r)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          {!tab.fits && (
            <div className="bulk-tab" style={{ height: tab.headH, right: `calc(0.0625rem + ${tab.sbw}px)` }}>
              <button type="button" aria-label="Show previous columns" title="Show previous columns" disabled={!tab.left} onClick={() => stepColumns(-1)}>‹</button>
              <button type="button" aria-label="Show next columns" title="Show next columns" disabled={!tab.right} onClick={() => stepColumns(1)}>›</button>
            </div>
          )}
        </div>
        </div>
      )}

      {shown.length > 0 && view === 'cards' && (
        <div className="bulk-scroll bulk-pr" style={{ flex: '1 1 0', minHeight: 0, width: 0, minWidth: '100%', overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1rem', alignContent: 'start', paddingRight: '3.5rem', paddingBottom: '1rem' }}>
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
        const otherRow = !existing && d?.inFile.length ? queue[d.inFile[0]].newPatient : null;
        const side = (title: string, lines: [string, string][], note?: string) => (
          <div style={{ flex: '1 1 14rem', minWidth: 0, border: `0.0625rem solid ${LINE}`, borderRadius: '0.75rem', padding: '0.875rem' }}>
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
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: '100%', maxWidth: '44rem', maxHeight: '90vh', overflow: 'auto', boxSizing: 'border-box' }}>
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Is this the same child?</h2>
              <p style={{ margin: '0.25rem 0 1rem', fontSize: '0.8125rem', color: MUTED }}>
                Same school, same birthday and same name. Check the details before saving.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {side('From the upload', [
                  ['Name', [p.lastName, p.firstName].filter(Boolean).join(', ') + (p.middleName ? ` ${p.middleName}` : '')],
                  ['Birthdate', p.birthdate], ['Sex', p.gender], ['Grade', [p.grade, p.section].filter(Boolean).join(' ')], ['School', p.school],
                ])}
                {existing
                  ? side('Already in records', [
                      ['Name', existing.full_name], ['Birthdate', String(existing.birthday ?? '').slice(0, 10)], ['Sex', existing.sex],
                      ['Grade', [existing.grade_level, existing.section].filter(Boolean).join(' ')], ['School', p.school],
                    ], d && d.onFile.length > 1 ? `${d.onFile.length - 1} more record(s) in the system also match.` : undefined)
                  : otherRow && side(`Also in this upload (row ${(d?.inFile[0] ?? 0) + 1})`, [
                      ['Name', [otherRow.lastName, otherRow.firstName].filter(Boolean).join(', ') + (otherRow.middleName ? ` ${otherRow.middleName}` : '')],
                      ['Birthdate', otherRow.birthdate], ['Sex', otherRow.gender], ['Grade', [otherRow.grade, otherRow.section].filter(Boolean).join(' ')], ['School', otherRow.school],
                    ])}
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
