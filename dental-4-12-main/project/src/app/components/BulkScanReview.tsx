import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { REQUIRED_STUDENT_FIELDS } from './PatientList';
import type { ExtractedHandoff } from './ScanStudentForm';
import { calculateAge } from '../utils/age';

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

const Status = ({ r, saved }: { r: Row; saved: boolean }) => {
  if (saved) return <span style={pill('#DCFCE7', '#166534')}>Saved</span>;
  if (r.h.readError) return <span style={pill('#FEE2E2', '#B91C1C')}>Could not read</span>;
  if (r.missing.length) return <span style={pill('#FEE2E2', '#B91C1C')}>Missing {r.missing[0].toLowerCase()}{r.missing.length > 1 ? ` +${r.missing.length - 1}` : ''}</span>;
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
  const state = location.state as { queue?: ExtractedHandoff[]; saved?: number[] } | null;
  const queue = state?.queue ?? null;
  const saved = useMemo(() => new Set(state?.saved ?? []), [state]);
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'grid'; } catch { return 'grid'; }
  });
  const chooseView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable: the choice still holds for this visit */ }
  };
  const [onlyFixes, setOnlyFixes] = useState(false);

  const rows: Row[] = useMemo(
    () => (queue ?? []).map((h, index) => ({ index, h, missing: h.readError ? [] : missingOf(h) })),
    [queue],
  );

  const shell: CSSProperties = {
    background: '#F6F9FC', minHeight: '100%', padding: '0.25rem 3.5rem 2.5rem', fontFamily: 'var(--font-sans)', color: '#141413',
    minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden',
  };

  // A refresh drops router state, so there is nothing to review.
  if (!queue?.length) {
    return (
      <div style={shell}>
        <p style={{ fontSize: '0.875rem', color: MUTED }}>There is nothing to review. Upload the file again to start.</p>
        <button type="button" onClick={() => navigate('/students/scan?bulk=1')} style={{ ...primaryBtn, marginTop: '0.75rem' }}>Upload files</button>
      </div>
    );
  }

  const open = (index: number) =>
    navigate('/students/scan/review', { state: { queue, startIndex: index, returnTo: '/students/scan/bulk', saved: [...saved] } });
  const firstOpen = rows.find((r) => !saved.has(r.index))?.index ?? 0;
  const isFix = (r: Row) => !saved.has(r.index) && (!!r.h.readError || r.missing.length > 0);
  const ready = rows.filter((r) => !saved.has(r.index) && !r.h.readError && r.missing.length === 0).length;
  const fixes = rows.filter(isFix).length;
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
    { label: 'Status', cell: (r) => <Status r={r} saved={saved.has(r.index)} /> },
    { label: 'Form', cell: (r) => openBtn(r) },
  ];

  // Excel look in the app's blue: navy header row, light-blue frozen Student column,
  // thin gridlines on every cell, softly banded rows.
  const head: CSSProperties = {
    position: 'sticky', top: 0, zIndex: 3, background: NAVY, color: '#fff', textAlign: 'left', whiteSpace: 'nowrap',
    padding: '0.5625rem 0.75rem', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    borderRight: '0.0625rem solid rgba(255,255,255,0.18)', borderBottom: `0.0625rem solid ${NAVY}`,
  };
  const cell: CSSProperties = {
    whiteSpace: 'nowrap', padding: '0.5rem 0.75rem', fontSize: '0.8125rem', borderRight: `0.0625rem solid ${GRID_LINE}`, borderBottom: `0.0625rem solid ${GRID_LINE}`,
  };

  return (
    <div style={shell}>
      {/* Header, same shape as the Scan and Verify pages */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
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
          <button type="button" onClick={() => navigate('/students/scan?bulk=1')} style={secondaryBtn}>
            <svg width="12.8" height="12.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            Back
          </button>
        </div>
      </div>

      {/* Summary, filter and the Grid / Cards switch sit directly above the list */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
        <span style={chip}><b>{rows.length}</b> found</span>
        <span style={chip}><b style={{ color: '#15803D' }}>{ready}</b> ready</span>
        <span style={chip}><b style={{ color: '#B91C1C' }}>{fixes}</b> need fixes</span>
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
              style={{ cursor: 'pointer', border: 'none', padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 600, background: view === v ? NAVY : '#fff', color: view === v ? '#fff' : '#141413' }}
            >
              {v === 'grid' ? 'Grid' : 'Cards'}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <p style={{ fontSize: '0.875rem', color: MUTED }}>No student needs fixes.</p>}

      {shown.length > 0 && view === 'grid' && (
        // The pane scrolls on its own (both ways) and fills the screen below the header,
        // like a spreadsheet: the header row and Student column never leave the frame.
        <div style={{ maxHeight: 'calc(100vh - 17rem)', minHeight: '16rem', maxWidth: '100%', overflow: 'auto', background: '#fff', border: `0.0625rem solid ${GRID_LINE}`, borderRadius: '0.75rem' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...head, left: 0, zIndex: 5 }}>Student</th>
                {cols.map((c) => <th key={c.label} style={head}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const band = i % 2 ? '#F5F8FF' : '#fff';
                return (
                  <tr key={r.index} onClick={() => open(r.index)} style={{ cursor: 'pointer', background: band }}>
                    <td style={{ ...cell, position: 'sticky', left: 0, zIndex: 2, background: '#E8EEFB', fontWeight: 700, color: NAVY, boxShadow: `1px 0 0 ${GRID_LINE}` }}>{fullName(r.h, r.index)}</td>
                    {cols.map((c) => <td key={c.label} style={cell}>{c.cell(r)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1rem' }}>
          {shown.map((r) => {
            const p = r.h.newPatient;
            return (
              <div key={r.index} style={{ background: '#fff', border: `${isFix(r) ? '0.09375rem' : '0.0625rem'} solid ${isFix(r) ? '#F87171' : LINE}`, borderRadius: '1rem', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.625rem' }}>
                  <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(r.h, r.index)}</h2>
                  <Status r={r} saved={saved.has(r.index)} />
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
      <p style={{ margin: '0.625rem 0 0', fontSize: '0.75rem', color: MUTED }}>
        {view === 'grid' ? 'Scroll inside the grid: the header row and the Student column stay in view. ' : ''}
        Click a student, or Open full form, to check and save that student.
      </p>
    </div>
  );
};
