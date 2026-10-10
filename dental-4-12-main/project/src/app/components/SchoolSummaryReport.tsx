import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import { useSchoolSummary, type BySex, type SchoolSummaryTally } from '../hooks/useSchoolSummary';
import { SkeletonTable } from './Skeleton';
import { buildDohReportPdf } from '../utils/exportPdf';
import { buildXlsx } from '../utils/exportXlsx';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { PreviewModal } from './PreviewModal';
import type { ReactNode } from 'react';
import { GraduationCap } from 'lucide-react';
import { PanelShell, PanelRow, GroupBox, ExportMenu, FiltersButton, FilterChip } from './ReportControls';
import { PeriodDatesBoxes } from './PeriodDatesBoxes';
import { downloadBlob } from '../utils/exportCsv';

// ─── Per-school summary sheet ────────────────────────────────────────────────
// Transcribed from the scan the user supplied 2026-09-03, headed "SOUTH DAANG
// HARI" — the dentist's one-page summary per school. Nothing in the app
// produced this shape before: the Program Report aggregates by age band and
// the Target Client List is per patient.
//
// ⚠ THE COLUMN READING IS A USER DECISION (2026-09-03), NOT AN INFERENCE.
// The sheet reads MALE | TOTAL | FEMALE | TOTAL, which is ambiguous on paper.
// The user confirmed: **MALE/FEMALE count STUDENTS, each TOTAL counts TEETH.**
// The alternatives considered and rejected were "TOTAL = male+female" and
// "TOTAL = a per-sex subtotal". Do not re-interpret this without asking.
//
// ⚠ CAPTIONS ARE VERBATIM, TYPOS INCLUDED — "No Flouride", and "Number Total
// decayed" with its lowercase d against "Total Number Decayed" above it. Same
// rule as the DOH workbook's repeated "1st Visit" (Sprint 84): the form is the
// form. Correcting spelling here would make the printout stop matching the
// paper it is filed beside.

/** What a cell with no source says — the same mark the other DOH forms use, so
 *  a reader learns it once. Never a 0: 0 claims a negative finding. */
const NO_SOURCE_MARK = '—';

type CellSource =
  /** Count of students, then count of teeth, from the tooth-condition code. */
  | { kind: 'code'; code: string }
  /** Count of students from an ORAL_HEALTH_CONDITION boolean. Patient-level,
   *  so the teeth column has no source. */
  | { kind: 'condition'; key: string }
  /** Students with no fluoride varnish recorded. Patient-level likewise. */
  | { kind: 'noFluoride' }
  /** Printed on the form, deliberately left blank — see NOTES. */
  | { kind: 'blank' };

type Row = {
  /** Left column. Empty string continues the label above, as the paper does:
   *  "Total Number Decayed" is printed once and spans (D)(M)(F)(X). */
  label: string;
  /** The bracketed code column, e.g. "(D)". */
  code: string;
  source: CellSource;
};

const ROWS: Row[] = [
  { label: 'Dental Caries', code: '', source: { kind: 'code', code: 'caries' } },
  { label: 'Gingivitis', code: '', source: { kind: 'condition', key: 'gingivitis' } },
  { label: 'Debris', code: '', source: { kind: 'condition', key: 'debris' } },
  { label: 'Calculus', code: '', source: { kind: 'condition', key: 'calculus' } },
  { label: 'Total Number Decayed', code: '(D)', source: { kind: 'code', code: 'D' } },
  { label: '', code: '(M)', source: { kind: 'code', code: 'M' } },
  { label: '', code: '(F)', source: { kind: 'code', code: 'F' } },
  { label: '', code: '(X)', source: { kind: 'code', code: 'X' } },
  // ⚠ The form asks for (d)(f)(x) and NO (m) — standard dft, because a missing
  // primary tooth is usually natural exfoliation. Not an omission to fix.
  { label: 'Number Total decayed', code: '(d)', source: { kind: 'code', code: 'd' } },
  { label: '', code: '(f)', source: { kind: 'code', code: 'f' } },
  { label: '', code: '(x)', source: { kind: 'code', code: 'x' } },
  { label: 'Very Good', code: '(VG)', source: { kind: 'blank' } },
  { label: 'No Flouride', code: '', source: { kind: 'noFluoride' } },
];

/** `null` renders as the no-source mark; a number renders as itself. */
type Cell = { persons: number | null; teeth: number | null };

function cellFor(source: CellSource, tally: SchoolSummaryTally, sex: keyof BySex): Cell {
  switch (source.kind) {
    case 'code':
      return {
        persons: tally.personsByCode[source.code]?.[sex] ?? 0,
        teeth: tally.teethByCode[source.code]?.[sex] ?? 0,
      };
    case 'condition':
      // Teeth: null, and that is a finding, not an oversight.
      // ORAL_HEALTH_CONDITION records gingivitis/debris/calculus as one boolean
      // for the whole mouth. There is no per-tooth record of them anywhere in
      // the data model, so a tooth count cannot be produced without inventing
      // one.
      return { persons: tally.personsByCondition[source.key]?.[sex] ?? 0, teeth: null };
    case 'noFluoride':
      return { persons: tally.noFluoride[sex], teeth: null };
    case 'blank':
      return { persons: null, teeth: null };
  }
}

const show = (value: number | null) => (value === null ? NO_SOURCE_MARK : String(value));

interface Props {
  schoolName: string | null;
  schoolYear: string | null;
  /** The shared school-year select, rendered by Reports (same state as the DOH tab). */
  yearPicker?: ReactNode;
}

export function SchoolSummaryReport({ schoolName, schoolYear, yearPicker = null }: Props) {
  // → A short summary sheet, not a wide grid.
  usePrintOrientation('portrait');
  const { tally, unsexedCount, loading, error } = useSchoolSummary(schoolName, schoolYear);
  const printableRef = useRef<HTMLDivElement>(null);
  // Height of the pinned title row, so the column header row sticks right under it.
  const titleRowRef = useRef<HTMLTableRowElement>(null);
  const [titleH, setTitleH] = useState(34);
  const { preview, building, previewPdf, closePreview, confirmDownload } = usePreviewModal();
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const rows = useMemo(
    () => ROWS.map((row) => ({
      ...row,
      male: cellFor(row.source, tally, 'Male'),
      female: cellFor(row.source, tally, 'Female'),
    })),
    [tally],
  );

  const exportBaseName = [
    'School-Summary',
    (schoolName ?? 'All-schools').replace(/[^A-Za-z0-9]+/g, '-'),
    schoolYear ?? 'all-years',
  ].join('_');

  const onPdf = () => {
    if (!printableRef.current) return;
    const el = printableRef.current;
    previewPdf('School Summary Report', `${exportBaseName}.pdf`, () => buildDohReportPdf(el));
  };

  // Excel downloads straight away (user-approved Print menu, 2026-10-08); the
  // PDF is the one that opens a preview first.
  const onXlsx = async () => {
    setXlsxBusy(true);
    try {
      // Writes exactly what the screen shows, "—" included. Turning a "—" into
      // 0 in a workbook converts "no source" into "none found" the moment the
      // file leaves the app (Sprint 85's rule).
      const blob = await buildXlsx(
        rows,
        [
          { label: schoolName ?? 'All schools', value: (r) => (r.label && r.code ? `${r.label} ${r.code}` : r.label || r.code) },
          { label: 'MALE', value: (r) => show(r.male.persons) },
          { label: 'TOTAL', value: (r) => show(r.male.teeth) },
          { label: 'FEMALE', value: (r) => show(r.female.persons) },
          { label: 'TOTAL', value: (r) => show(r.female.teeth) },
        ],
        'School Summary',
      );
      downloadBlob(blob, `${exportBaseName}.xlsx`);
    } finally {
      setXlsxBusy(false);
    }
  };

  // Layout asked for by the user (2026-10-08): the same panel as Internal
  // Reports without its report tabs. Time period, Dates and Filters keep their
  // own state but are NOT read by this sheet yet (the user will say what they
  // should do), so a plain line under the panel says so. The School year box is
  // the control that actually scopes the sheet.
  const [ageF, setAgeF] = useState('all');
  const [gradeF, setGradeF] = useState('all');
  const [sexF, setSexF] = useState('all');
  const activeFilters = [ageF, gradeF, sexF].filter((v) => v !== 'all').length;
  const filterDefs = [
    { label: 'Age', value: ageF, set: (v: string) => { setAgeF(v); setGradeF('all'); }, opts: [['all', 'All ages'], ['4 & below', 'Age: 4 & below'], ['5-9', 'Age: 5-9'], ['10-14', 'Age: 10-14'], ['15-19', 'Age: 15-19'], ['20 & above', 'Age: 20 & above']] },
    { label: 'Grade', value: gradeF, set: (v: string) => { setGradeF(v); setAgeF('all'); }, opts: [['all', 'All grades'], ...['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'].map((g) => [g, g])] },
    { label: 'Sex', value: sexF, set: setSexF, opts: [['all', 'All sex'], ['M', 'Male'], ['F', 'Female']] },
  ];
  const panel = (
    <PanelShell>
      <PanelRow>
        <PeriodDatesBoxes />
        <GroupBox title="School year" icon={GraduationCap} className="w-full lg:w-auto lg:px-6">{yearPicker}</GroupBox>
        <div className="flex self-start lg:ml-auto">
          <FiltersButton count={activeFilters}>
            {filterDefs.map((f) => (
              <div key={f.label}>
                <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{f.label}</div>
                <select aria-label={f.label} value={f.value} onChange={(e) => f.set(e.target.value)}
                  className="h-10 w-full rounded-lg border border-[#e3e7ef] bg-[#f1f3f8] px-3 text-[13.5px] font-bold text-[#46536d]">
                  {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
          </FiltersButton>
          {/* Print / PDF (preview first) / Excel (downloads), as on Internal Reports.
              Aggregate counts, no patient names, bounded width (Sprint 85). */}
          <ExportMenu joined busy={xlsxBusy || (building && preview.kind === 'pdf')} onPrint={() => window.print()} onPdf={onPdf} onExcel={() => { void onXlsx(); }} />
        </div>
      </PanelRow>
      {activeFilters > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">Showing</span>
          {ageF !== 'all' && <FilterChip onRemove={() => setAgeF('all')}>{`Age ${ageF}`}</FilterChip>}
          {gradeF !== 'all' && <FilterChip onRemove={() => setGradeF('all')}>{gradeF}</FilterChip>}
          {sexF !== 'all' && <FilterChip onRemove={() => setSexF('all')}>{sexF === 'M' ? 'Male' : 'Female'}</FilterChip>}
          <button type="button" onClick={() => { setAgeF('all'); setGradeF('all'); setSexF('all'); }} className="ml-auto text-[13px] font-bold text-destructive hover:underline">Clear all</button>
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-muted-foreground">
        Time period, Dates and Filters are not connected to this sheet yet. It still follows the school year.
      </p>
      <p className="sr-only" aria-live="polite">Showing {schoolName ?? 'all schools'}, {schoolYear ? `school year ${schoolYear}` : 'all years to date'}</p>
    </PanelShell>
  );

  useEffect(() => {
    const el = titleRowRef.current;
    if (!el) return;
    const measure = () => setTitleH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, error]);

  if (loading) return <div className="space-y-3">{panel}<SkeletonTable rows={13} /></div>;
  if (error) {
    return (
      <div className="space-y-3">
        {panel}
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  const TH = 'border-r border-b border-gray-300 px-2 py-1.5';
  const TD = 'border-r border-b border-gray-300 px-2 py-1';
  return (
    <div className="space-y-8">
      {panel}
      <div className="rounded-2xl border border-[#dfe5f0] bg-card px-5 py-4 shadow-[0_14px_30px_-22px_rgba(36,59,122,0.5)]">
        <h2 className="text-base font-extrabold text-foreground">School Summary Sheet</h2>
        <dl className="mt-2 flex flex-wrap gap-y-2 [&>div]:border-l [&>div]:border-[#dfe5f0] [&>div]:px-4 [&>div:first-child]:border-l-0 [&>div:first-child]:pl-0 [&_dt]:text-[9px] [&_dt]:font-extrabold [&_dt]:uppercase [&_dt]:tracking-[0.08em] [&_dt]:text-muted-foreground [&_dd]:text-[12px] [&_dd]:font-bold">
          <div><dt>School</dt><dd>{schoolName ?? 'All schools'}</dd></div>
          <div><dt>School year</dt><dd>{schoolYear ?? 'All years to date'}</dd></div>
          <div><dt>Barangay</dt><dd>Tanyag, Taguig City</dd></div>
        </dl>
      </div>

      <div className="form-print relative overflow-hidden rounded-xl border border-[#A9BDE6] bg-card">
      <div
        ref={printableRef}
        className="no-scrollbar max-h-[max(320px,calc(100vh_-_94px))] overflow-auto rounded-xl print:max-h-none [&_tr>:last-child]:border-r-0 [&_tbody>tr:last-child>td]:border-b-0"
        style={{ ['--ss-r1' as string]: `${titleH}px` }}
      >
        {/* Wide content scrolls inside its own container, so the table never
            pushes the page sideways at 390px (CLAUDE.md, three device classes). */}
        <div>
          <table className="w-full min-w-[800px] text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '27rem' }} /><col /><col /><col /><col /></colgroup>
            <thead>
              <tr ref={titleRowRef} className="[&>th]:sticky [&>th]:top-0 [&>th]:z-20">
                {/* The paper sheet's single top band carries the school name. */}
                <th colSpan={5} className="border-b border-gray-300 bg-[#CFDDF6] px-2 py-2 text-center text-[12px] font-bold uppercase tracking-wide text-[#273A78]">
                  {schoolName ?? 'All schools'}
                </th>
              </tr>
              <tr className="[&>th]:sticky [&>th]:top-[var(--ss-r1)] [&>th]:z-20 [&>th]:bg-gray-200">
                <th className={`${TH} text-left font-semibold`} />
                <th className={`${TH} font-semibold`}>MALE</th>
                <th className={`${TH} font-semibold`}>TOTAL</th>
                <th className={`${TH} font-semibold`}>FEMALE</th>
                <th className={`${TH} font-semibold`}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.label}-${row.code}-${i}`}>
                  <td className={`${TD} font-medium text-foreground`}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span>{row.label}</span>
                      <span className="pr-[20%]">{row.code}</span>
                    </div>
                  </td>
                  <td className={`${TD} text-center tabular-nums`}>{show(row.male.persons)}</td>
                  <td className={`${TD} text-center tabular-nums`}>{show(row.male.teeth)}</td>
                  <td className={`${TD} text-center tabular-nums`}>{show(row.female.persons)}</td>
                  <td className={`${TD} text-center tabular-nums`}>{show(row.female.teeth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Every claim the table makes, and every one it declines to make.
            Inside the printable region deliberately: a filed copy that shows
            "—" without saying why invites someone to read it as zero. */}
        {/* ⚠ `print-hide` (Sprint 133): these notes explain the SYSTEM to a
            reader on screen — why a cell reads "—", why there is no (m)
            row — and none of them is printed on the paper sheet. They sit
            inside the printable root because they belong beside the table
            on screen, so print has to drop them explicitly. The sheet filed
            with the City Health Office must look like the official form. */}
        <div className="print-hide space-y-1 px-3 py-2.5 text-[11px] empty:hidden leading-relaxed text-muted-foreground">
          {unsexedCount > 0 && (
            <p className="text-yellow-700">
              {unsexedCount} student{unsexedCount === 1 ? '' : 's'} in this scope {unsexedCount === 1 ? 'has' : 'have'}{' '}
              no recorded sex and {unsexedCount === 1 ? 'is' : 'are'} in neither column.
            </p>
          )}
        </div>
      </div>
      </div>
      <PreviewModal
        open={preview.open}
        kind={preview.kind}
        title={preview.title}
        url={preview.url}
        onClose={closePreview}
        onDownload={confirmDownload}
      />
    </div>
  );
}
