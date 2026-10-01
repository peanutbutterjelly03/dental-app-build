import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, LayoutGrid, Table2 } from 'lucide-react';
import { REQUIRED_STUDENT_FIELDS } from './PatientList';
import type { ExtractedHandoff } from './ScanStudentForm';
import { calculateAge } from '../utils/age';

// Bulk upload review (user, 2026-10-01): the OCR button reads several forms or a
// spreadsheet with many rows, and lands HERE first, so every extracted student
// is visible on one page. Grid is the main view (header row, Student column and
// the Open button frozen); Cards is the second view. Clicking a student opens
// the existing Verify page at that student. Nothing is saved from this page.

const VIEW_KEY = 'bulk-scan-view';
type View = 'grid' | 'cards';

type Row = {
  index: number;
  h: ExtractedHandoff;
  missing: string[];
};

const missingOf = (h: ExtractedHandoff): string[] =>
  REQUIRED_STUDENT_FIELDS
    .filter(({ onlyIf }) => (onlyIf ? onlyIf(h.newPatient) : true))
    .filter(({ key }) => !String(h.newPatient[key] ?? '').trim())
    .map((f) => f.label);

const fullName = (h: ExtractedHandoff) => {
  const p = h.newPatient;
  const n = [p.lastName, p.firstName].filter(Boolean).join(', ');
  return n || h.sourceFileName;
};

const Status = ({ r, saved }: { r: Row; saved: boolean }) => {
  if (saved) return <span className="whitespace-nowrap rounded-full bg-green-100 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800">Saved</span>;
  if (r.h.readError) return <span className="whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-[11.5px] font-bold text-red-700">Could not read</span>;
  if (r.missing.length) {
    return <span className="whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-[11.5px] font-bold text-red-700">Missing {r.missing[0].toLowerCase()}{r.missing.length > 1 ? ` +${r.missing.length - 1}` : ''}</span>;
  }
  return <span className="whitespace-nowrap rounded-full bg-green-100 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800">Ready</span>;
};

const Req = ({ value }: { value: string }) =>
  value ? <>{value}</> : <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11.5px] text-red-700">required</span>;

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

  // A refresh drops router state, so there is nothing to review.
  if (!queue?.length) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">There is nothing to review. Upload the file again to start.</p>
        <button onClick={() => navigate('/students/scan?bulk=1')} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">Upload files</button>
      </div>
    );
  }

  const open = (index: number) =>
    navigate('/students/scan/review', { state: { queue, startIndex: index, returnTo: '/students/scan/bulk', saved: [...saved] } });
  const firstOpen = rows.find((r) => !saved.has(r.index))?.index ?? 0;
  const ready = rows.filter((r) => !saved.has(r.index) && !r.h.readError && r.missing.length === 0).length;
  const fixes = rows.filter((r) => !saved.has(r.index) && (r.h.readError || r.missing.length > 0)).length;
  const shown = onlyFixes ? rows.filter((r) => !saved.has(r.index) && (r.h.readError || r.missing.length > 0)) : rows;

  const openBtn = (r: Row) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); open(r.index); }}
      className="whitespace-nowrap rounded-full border border-primary px-3 py-1 text-xs font-bold text-primary hover:bg-primary-surface"
    >
      Open full form
    </button>
  );

  const cols: { label: string; cell: (r: Row) => React.ReactNode }[] = [
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
  ];

  const th = 'sticky top-0 z-10 whitespace-nowrap bg-gray-100 px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Students · OCR · Bulk upload</div>
          <h1 className="text-2xl font-bold text-foreground">Review Imported Students</h1>
          <p className="text-sm text-muted-foreground">{rows.length} student{rows.length === 1 ? '' : 's'} found. Nothing is saved until you open each form and confirm it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border" role="group" aria-label="View">
            <button type="button" onClick={() => chooseView('grid')} aria-pressed={view === 'grid'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'grid' ? 'bg-primary text-white' : 'bg-card text-foreground hover:bg-gray-50'}`}>
              <Table2 className="h-4 w-4" /> Grid
            </button>
            <button type="button" onClick={() => chooseView('cards')} aria-pressed={view === 'cards'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${view === 'cards' ? 'bg-primary text-white' : 'bg-card text-foreground hover:bg-gray-50'}`}>
              <LayoutGrid className="h-4 w-4" /> Cards
            </button>
          </div>
          <button type="button" onClick={() => navigate('/students/scan?bulk=1')} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button type="button" onClick={() => open(firstOpen)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
            Review one by one
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-border bg-card px-3 py-1"><b>{rows.length}</b> found</span>
        <span className="rounded-full border border-border bg-card px-3 py-1"><b className="text-green-700">{ready}</b> ready</span>
        <span className="rounded-full border border-border bg-card px-3 py-1"><b className="text-red-700">{fixes}</b> need fixes</span>
        {saved.size > 0 && <span className="rounded-full border border-border bg-card px-3 py-1"><b className="text-green-700">{saved.size}</b> saved</span>}
        <button type="button" onClick={() => setOnlyFixes((v) => !v)} aria-pressed={onlyFixes}
          className="ml-auto rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-gray-50">
          {onlyFixes ? 'Show all students' : 'Show only: Needs fixes'}
        </button>
      </div>

      {shown.length === 0 && <p className="text-sm text-muted-foreground">No student needs fixes.</p>}

      {shown.length > 0 && view === 'grid' && (
        <div className="max-h-[68vh] overflow-auto rounded-xl border-2 border-slate-300 bg-card shadow-sm">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className={`${th} left-0 z-20 shadow-[1px_0_0_var(--border)]`}>Student</th>
                {cols.map((c) => <th key={c.label} className={th}>{c.label}</th>)}
                <th className={`${th} right-0 z-20 shadow-[-1px_0_0_var(--border)]`}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.index} onClick={() => open(r.index)} className="group cursor-pointer">
                  <td className="sticky left-0 z-[5] whitespace-nowrap border-t border-border bg-card px-3 py-2 font-bold shadow-[1px_0_0_var(--border)] group-hover:bg-primary-surface">{fullName(r.h)}</td>
                  {cols.map((c) => <td key={c.label} className="whitespace-nowrap border-t border-border px-3 py-2 group-hover:bg-primary-surface">{c.cell(r)}</td>)}
                  <td className="sticky right-0 z-[5] border-t border-border bg-card px-3 py-2 shadow-[-1px_0_0_var(--border)] group-hover:bg-primary-surface">{openBtn(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && view === 'cards' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => {
            const p = r.h.newPatient;
            const bad = !saved.has(r.index) && (r.h.readError || r.missing.length > 0);
            return (
              <div key={r.index} className={`rounded-2xl border bg-card p-4 ${bad ? 'border-red-400' : 'border-border'}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="min-w-0 truncate text-sm font-bold">{fullName(r.h)}</h2>
                  <Status r={r} saved={saved.has(r.index)} />
                </div>
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-0.5 text-[12.5px]">
                  <dt className="text-muted-foreground">Grade</dt><dd><Req value={p.grade} /></dd>
                  <dt className="text-muted-foreground">Section</dt><dd><Req value={p.section} /></dd>
                  <dt className="text-muted-foreground">Sex</dt><dd><Req value={p.gender} /></dd>
                  <dt className="text-muted-foreground">Birthdate</dt><dd><Req value={p.birthdate} /></dd>
                  <dt className="text-muted-foreground">Guardian</dt><dd>{p.guardianName}</dd>
                </dl>
                {r.h.readError && <p className="mt-2 text-xs text-red-700">{r.h.readError}</p>}
                <div className="mt-3 text-right">{openBtn(r)}</div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {view === 'grid' ? 'The header row, the Student column and the Open button stay in place while you scroll. ' : ''}
        Click a student, or Open full form, to check and save that student.
      </p>
    </div>
  );
};
