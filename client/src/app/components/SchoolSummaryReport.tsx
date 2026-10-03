import { useMemo, useRef, useState } from 'react';
import { useSchoolSummary, type BySex, type SchoolSummaryTally } from '../hooks/useSchoolSummary';
import { SkeletonTable } from './Skeleton';
import { FORM_SECTION_BAND } from '../utils/dohFormStyle';
import { exportDohReportToPdf } from '../utils/exportPdf';
import { exportToXlsx } from '../utils/exportXlsx';
import { Download, FileSpreadsheet } from 'lucide-react';

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
}

export function SchoolSummaryReport({ schoolName, schoolYear }: Props) {
  const { tally, unsexedCount, loading, error } = useSchoolSummary(schoolName, schoolYear);
  const printableRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

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

  const onPdf = async () => {
    if (!printableRef.current) return;
    setBusy('pdf');
    try {
      await exportDohReportToPdf(printableRef.current, `${exportBaseName}.pdf`);
    } finally {
      setBusy(null);
    }
  };

  const onXlsx = async () => {
    setBusy('xlsx');
    try {
      // Writes exactly what the screen shows, "—" included. Turning a "—" into
      // 0 in a workbook converts "no source" into "none found" the moment the
      // file leaves the app (Sprint 85's rule).
      await exportToXlsx(
        rows,
        [
          { label: schoolName ?? 'All schools', value: (r) => r.label },
          { label: '', value: (r) => r.code },
          { label: 'MALE', value: (r) => show(r.male.persons) },
          { label: 'TOTAL', value: (r) => show(r.male.teeth) },
          { label: 'FEMALE', value: (r) => show(r.female.persons) },
          { label: 'TOTAL', value: (r) => show(r.female.teeth) },
        ],
        `${exportBaseName}.xlsx`,
        'School Summary',
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <SkeletonTable rows={13} />;
  if (error) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">School Summary Sheet</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {schoolName ?? 'All schools'} · Barangay Tanyag, Taguig City
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {schoolYear ? `School year ${schoolYear}` : 'All years to date'}
            </span>
            {/* PDF *and* Excel, like the Program Report: aggregate counts, no
                patient names, bounded width — none of the Target Client List's
                PII weight (Sprint 85). */}
            <button
              onClick={onPdf}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />{busy === 'pdf' ? 'Preparing…' : 'PDF'}
            </button>
            <button
              onClick={onXlsx}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}
            </button>
          </div>
        </div>
      </div>

      <div ref={printableRef} className="bg-card rounded-xl border border-border p-4">
        {/* Wide content scrolls inside its own container — the table must never
            push the page sideways at 390px (CLAUDE.md, three device classes). */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr>
                {/* The paper sheet's single top band carries the school name. */}
                <th colSpan={6} className={`${FORM_SECTION_BAND} border border-gray-500 px-2 py-1.5 text-center text-sm font-bold uppercase`}>
                  {schoolName ?? 'All schools'}
                </th>
              </tr>
              <tr className="bg-gray-100">
                <th className="border border-gray-500 px-2 py-1 text-left font-semibold" />
                <th className="border border-gray-500 px-2 py-1" />
                <th className="border border-gray-500 px-2 py-1 font-semibold">MALE</th>
                <th className="border border-gray-500 px-2 py-1 font-semibold">TOTAL</th>
                <th className="border border-gray-500 px-2 py-1 font-semibold">FEMALE</th>
                <th className="border border-gray-500 px-2 py-1 font-semibold">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.label}-${row.code}-${i}`}>
                  <td className="border border-gray-500 px-2 py-1 font-medium text-foreground">{row.label}</td>
                  <td className="border border-gray-500 px-2 py-1 text-center font-medium">{row.code}</td>
                  <td className="border border-gray-500 px-2 py-1 text-center tabular-nums">{show(row.male.persons)}</td>
                  <td className="border border-gray-500 px-2 py-1 text-center tabular-nums">{show(row.male.teeth)}</td>
                  <td className="border border-gray-500 px-2 py-1 text-center tabular-nums">{show(row.female.persons)}</td>
                  <td className="border border-gray-500 px-2 py-1 text-center tabular-nums">{show(row.female.teeth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Every claim the table makes, and every one it declines to make.
            Inside the printable region deliberately: a filed copy that shows
            "—" without saying why invites someone to read it as zero. */}
        <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-semibold">MALE / FEMALE</span> count students; each{' '}
            <span className="font-semibold">TOTAL</span> counts teeth.{' '}
            <span className="font-semibold">{NO_SOURCE_MARK}</span> means this system has no source for that
            cell — it is not a zero.
          </p>
          <p>
            <span className="font-semibold">Very Good (VG)</span> is left blank: oral hygiene is recorded as free
            text, with no "Very Good" option to count.
          </p>
          <p>
            Gingivitis, Debris and Calculus are recorded once per patient, not per tooth, so they have no TOTAL.
          </p>
          <p>
            <span className="font-semibold">No Flouride</span> counts students with no Fluoride Varnish recorded
            for this school year — including those with no record for the year at all.
          </p>
          <p>
            Rows follow the printed sheet exactly, spelling included, and primary teeth carry no (m) — a missing
            baby tooth is usually natural.
          </p>
          {unsexedCount > 0 && (
            <p className="text-yellow-700">
              {unsexedCount} student{unsexedCount === 1 ? '' : 's'} in this scope {unsexedCount === 1 ? 'has' : 'have'}{' '}
              no recorded sex and {unsexedCount === 1 ? 'is' : 'are'} in neither column.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
