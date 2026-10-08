import { useRef, useState } from 'react';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import { Calendar, CalendarDays, CalendarRange, Clock } from 'lucide-react';
import { RangePicker } from './RangePicker';
import { downloadBlob } from '../utils/exportCsv';
import { formatDate, toLocalDateString } from '../utils/localDate';
import { PanelShell, PanelRow, GroupBox, Underlined, PeriodSwitch, fieldInputClass, ExportMenu, BOX_W } from './ReportControls';
import { useFhsisData, FHSIS_BANDS, type FhsisBandKey, type Measure } from '../hooks/useFhsisData';
import { buildDohReportPdf } from '../utils/exportPdf';
import { buildXlsx } from '../utils/exportXlsx';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { PreviewModal } from './PreviewModal';
import { SkeletonTable } from './Skeleton';
import { FORM_SECTION_BAND } from '../utils/dohFormStyle';

// ─── FHSIS · SECTION D. ORAL HEALTH CARE SERVICES ────────────────────────────
// Transcribed from the "FHSIS" sheet of the workbook the user supplied
// (TCLForm2andFHSISReport.xlsx). That workbook carries TWO variants of this
// form: one headed "Health Center:" and one headed "School:". This is the
// SCHOOL one — the level Floral is scoped to. The health-centre variant
// consolidates sources Floral does not hold and is a separate report.
//
// The form is two mirrored halves: FIRST VISIT on the left, COMPLETED 2 VISITS
// on the right, each broken down by age band and sex. That maps directly onto
// the two-visit RPC module, so unlike the Program Report's Services Rendered
// rows, these numbers are REAL — counted from PREVENTIVE_CARE_RECORD.
//
// WHAT IS DELIBERATELY BLANK (CLAUDE.md, NOTHING COSMETIC — the form keeps all
// its rows, and a blank cell on a DOH form is meaningful):
//
//  * The `a` (facility-based) and `b` (non-facility-based) sub-rows, WHERE THE
//    FLAG IS UNRECORDED. Sprint 81 added PREVENTIVE_CARE_RECORD.facility_based
//    and a way to set it when recording a visit, so these rows now carry real
//    counts for visits recorded since. They default to NULL, though, so every
//    visit created before that has no answer: a cell with nothing flagged still
//    renders "—" rather than "0", because "0" claims nobody had facility-based
//    care where "—" says it was not recorded. When a cell has SOME flagged
//    visits and some not, the sub-rows show the real figures and the Remarks
//    column states how many are unclassified — so `a + b` falling short of the
//    total reads as missing data, not as an arithmetic error on a filed form.
//    Splitting the total on an assumption ("school screening must be
//    non-facility") would still be inventing a number, and is still not done.
//  * The Pregnant Women block. No pregnancy is recorded anywhere in the
//    schema, the same limitation the Oral Health Program Report hits.
//
// Age bands ARE all computed, including Infants and Seniors: a birthday is
// recorded, so those cells are genuine counts that happen to be 0 at a school,
// not fabrications. A true 0 and an unfillable cell are different claims and
// the form shows them differently.

const MEASURES: { key: Measure; heading: string; caption: (band: string) => string }[] = [
  {
    key: 'first',
    heading: 'FIRST VISIT TO AN ORAL HEALTH CARE PROFESSIONAL',
    caption: (b) => `${b} who had their 1st visit to an oral health care professional within a year`,
  },
  {
    key: 'completed',
    heading: 'COMPLETED 2 VISITS',
    caption: (b) => `${b} who completed 2 visits to an oral health care professional within a year`,
  },
];

/** Pregnant-women rows are on the printed form and have no source. */
const PREGNANT_AGE_GROUPS = ['10-14', '15-19', '20-49'] as const;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINALS = ['1st', '2nd', '3rd', '4th'];

// The workbook has 24 FHSIS sheets: 12 months, 4 quarters, 2 semi-annual and
// the Annual. A longer period is the sum of its months (shared/fhsis.ts).
type PeriodKind = 'range' | 'month' | 'quarter' | 'half' | 'year';
const pad = (n: number) => String(n).padStart(2, '0');

/** `pick` is the month (1-12), quarter (1-4) or half (1-2); ignored for a year. */
function describePeriod(kind: PeriodKind, pick: number, year: number, rangeStart: string, rangeEnd: string) {
  if (kind === 'range') {
    const label = rangeStart === rangeEnd ? formatDate(rangeStart) : `${formatDate(rangeStart)} to ${formatDate(rangeEnd)}`;
    return { key: `${rangeStart}..${rangeEnd}`, short: label, printed: label.toUpperCase() };
  }
  const first = kind === 'month' ? pick : kind === 'quarter' ? (pick - 1) * 3 + 1 : kind === 'half' ? (pick - 1) * 6 + 1 : 1;
  const last = kind === 'month' ? pick : kind === 'quarter' ? first + 2 : kind === 'half' ? first + 5 : 12;
  const key = first === last ? `${year}-${pad(first)}` : `${year}-${pad(first)}..${year}-${pad(last)}`;
  const short = first === last ? `${MONTH_NAMES[first - 1]} ${year}` : `${MONTH_NAMES[first - 1].slice(0, 3)} to ${MONTH_NAMES[last - 1].slice(0, 3)} ${year}`;
  // Printed in the form's "Month:" slot, worded like the workbook's sheet names.
  const printed = kind === 'month' ? `${MONTH_NAMES[pick - 1].toUpperCase()} ${year}`
    : kind === 'quarter' ? `${ORDINALS[pick - 1].toUpperCase()} QUARTER ${year}`
    : kind === 'half' ? `${ORDINALS[pick - 1].toUpperCase()} SEMI-ANNUAL ${year}`
    : `ANNUAL ${year}`;
  return { key, short, printed };
}

export const FhsisReport = ({ schoolName }: { schoolName: string }) => {
  // → A wide age-bracket × sex grid, like the other DOH tables.
  usePrintOrientation('landscape');
  const now = new Date();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [pick, setPick] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rangeStart, setRangeStart] = useState(() => toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [rangeEnd, setRangeEnd] = useState(() => toLocalDateString(now));
  const { key: month, short: periodShort, printed: periodPrinted } = describePeriod(kind, pick, year, rangeStart, rangeEnd);
  const { counts, monthsWithData, loading, error } = useFhsisData(month, schoolName);
  const printableRef = useRef<HTMLDivElement>(null);
  const { preview, building, previewPdf, closePreview, confirmDownload } = usePreviewModal();
  const [xlsxBusy, setXlsxBusy] = useState(false);

  /** Filename stamped with school + month, so downloads are distinguishable
   *  once several months are filed. */
  const baseName = `FHSIS-SectionD_${(schoolName || 'All-Schools').replace(/[^\w]+/g, '-')}_${month.replace('..', '_to_')}`;

  const onPdf = () => {
    if (!printableRef.current) return;
    const el = printableRef.current;
    previewPdf('FHSIS Section D', `${baseName}.pdf`, () => buildDohReportPdf(el));
  };

  // The Excel export writes the SAME cells the screen shows, "—" included, so
  // the downloaded workbook makes the identical claims as the report. Writing
  // 0 where the screen says "—" would quietly turn "not recorded" into
  // "examined none" the moment it left the app.
  // Excel downloads straight away (user-approved Print menu, 2026-10-08); the
  // PDF is the one that opens a preview first.
  const onXlsx = async () => {
    setXlsxBusy(true);
    try {
      const blob = await (async () => {
      type Row = { indicator: string; male: string; female: string; total: string; remarks: string };
      const rows: Row[] = [];
      const dash = { male: '—', female: '—', total: '—', remarks: 'not recorded' };
      for (const measure of MEASURES) {
        rows.push({ indicator: measure.heading, male: '', female: '', total: '', remarks: '' });
        FHSIS_BANDS.forEach((band, idx) => {
          const c = counts[band.key as FhsisBandKey][measure.key];
          const n = idx + 1;
          rows.push({
            indicator:
              band.key === 'infants'
                ? `${n}. Infants 0-11 months old who had their first dental visit`
                : `${n}. ${measure.caption(band.label)}`,
            male: String(c.male),
            female: String(c.female),
            total: String(c.male + c.female),
            remarks: '',
          });
          if (band.key === 'infants') return;
          for (const suffix of ['a', 'b'] as const) {
            rows.push({
              indicator: `${n}${suffix}. ${band.label} who ${measure.key === 'first' ? 'had their 1st visit' : 'completed 2 visits'} to a ${suffix === 'a' ? 'facility-based' : 'non-facility-based'} oral health care professional within a year`,
              ...dash,
            });
          }
        });
      }
      rows.push({ indicator: 'PREGNANT WOMEN (by age group)', male: '', female: '', total: '', remarks: '' });
      for (const measure of MEASURES) {
        for (const group of PREGNANT_AGE_GROUPS) {
          rows.push({
            indicator: `6. Pregnant Women ${group} who ${measure.key === 'first' ? 'had their 1st visit' : 'completed 2 visits'} to an oral health care professional within a year`,
            ...dash,
          });
        }
      }
      return buildXlsx(
        rows,
        [
          { label: `Indicators — School: ${schoolName || 'All schools'} — Month: ${periodPrinted}`, value: (r) => r.indicator },
          { label: 'Male', value: (r) => r.male },
          { label: 'Female', value: (r) => r.female },
          { label: 'Total', value: (r) => r.total },
          { label: 'Remarks', value: (r) => r.remarks },
        ],
        'FHSIS Section D',
      );
      })();
      downloadBlob(blob, `${baseName}.xlsx`);
    } finally {
      setXlsxBusy(false);
    }
  };

  const monthHasVisits = (m: number) => monthsWithData.includes(`${year}-${pad(m)}`);
  const panel = (
    <PanelShell>
      <PanelRow>
        <GroupBox title="Time period" icon={Clock} className={BOX_W}>
          <PeriodSwitch<PeriodKind> name="Time period" value={kind}
            options={[{ v: 'range', kind: 'range' }, { v: 'month', kind: 'month' }, { v: 'quarter', kind: 'quarter' }, { v: 'half', kind: 'half' }, { v: 'year', kind: 'year' }]}
            onChange={(k) => { setKind(k); setPick(k === 'month' ? now.getMonth() + 1 : 1); }} />
        </GroupBox>
        <GroupBox title="Dates" icon={CalendarDays} className="w-full lg:w-auto lg:px-6">
          {kind === 'range' ? (
            <RangePicker start={rangeStart} end={rangeEnd} onChange={(a, b) => { setRangeStart(a); setRangeEnd(b); }} />
          ) : (
          <div className="flex w-full gap-5 lg:w-auto lg:gap-6">
            {kind !== 'year' && (
              <Underlined label={kind === 'month' ? 'Month' : kind === 'quarter' ? 'Quarter' : 'Half'} icon={Calendar} chevron>
                <select aria-label="Period" value={pick} onChange={(e) => setPick(Number(e.target.value))} className={`${fieldInputClass} !pr-5`}>
                  {kind === 'month' && MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}{monthHasVisits(i + 1) ? '  ● has visits' : ''}</option>))}
                  {kind === 'quarter' && [1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>{ORDINALS[q - 1]} Quarter ({MONTH_NAMES[(q - 1) * 3].slice(0, 3)} to {MONTH_NAMES[q * 3 - 1].slice(0, 3)})</option>))}
                  {kind === 'half' && [1, 2].map((h) => (
                    <option key={h} value={h}>{ORDINALS[h - 1]} Semi-Annual ({h === 1 ? 'Jan to Jun' : 'Jul to Dec'})</option>))}
                </select>
              </Underlined>
            )}
            <Underlined label="Year" icon={Calendar} chevron>
              <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${fieldInputClass} !pr-5`}>
                {Array.from(new Set([...[3, 2, 1, 0].map((i) => now.getFullYear() - i), year])).sort().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Underlined>
          </div>
          )}
        </GroupBox>
        <div className="flex self-start lg:ml-auto">
          {/* Print / PDF (preview first) / Excel (downloads). */}
          <ExportMenu busy={xlsxBusy || (building && preview.kind === 'pdf')} onPrint={() => window.print()} onPdf={onPdf} onExcel={() => { void onXlsx(); }}
            excelDisabledReason={loading || error ? 'Loading' : undefined} pdfDisabledReason={loading || error ? 'Loading' : undefined} />
        </div>
      </PanelRow>
      <p className="sr-only" aria-live="polite">Showing {periodShort}, {schoolName || 'all schools'}</p>
    </PanelShell>
  );

  if (error) {
    return <div className="space-y-4">{panel}<div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div></div>;
  }
  if (loading) return <div className="space-y-4">{panel}<SkeletonTable rows={12} /></div>;

  const cell = (v: number) => <td className="border border-gray-300 px-2 py-1.5 text-center tabular-nums">{v}</td>;
  const blank = (title: string) => (
    <td className="border border-gray-300 px-2 py-1.5 text-center text-muted-foreground" title={title}>
      —
    </td>
  );
  const NO_FACILITY_FIELD = 'Not recorded — no visit counted here has its facility-based flag set. The flag is optional when recording an RPC visit, and visits recorded before it existed have no value.';
  const NO_PREGNANCY = 'Not recorded by this system — no pregnancy field exists in the schema.';

  return (
    <div className="space-y-4">
      {/* Controls: see ReportControls.tsx. */}
      {panel}

      {/* ref is on the OUTER box so the School/Month header band and the section
          title are captured WITH the table. html2canvas clips to the ref'd
          element's own rendered box, so a banner placed outside it shows on
          screen and is silently missing from the PDF — the exact trap noted on
          the DOH Consolidated report. */}
      <div ref={printableRef} className="form-print overflow-x-auto rounded-lg border border-gray-200 bg-card p-4">
        {/* Header band, as printed. */}
        <div className="mb-3 text-sm">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="font-semibold">School:</span> {schoolName || 'All schools'}
            </span>
            <span>
              <span className="font-semibold">Month:</span> {periodPrinted}
            </span>
          </div>
          <div className="mt-2 font-semibold">SECTION D. ORAL HEALTH CARE SERVICES</div>
        </div>

        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th rowSpan={2} className="border border-gray-300 px-2 py-1.5 text-left">Indicators</th>
              <th colSpan={2} className="border border-gray-300 px-2 py-1.5">Sex</th>
              <th rowSpan={2} className="border border-gray-300 px-2 py-1.5">Total</th>
              <th rowSpan={2} className="border border-gray-300 px-2 py-1.5">Remarks</th>
            </tr>
            <tr className="bg-gray-50">
              <th className="border border-gray-300 px-2 py-1.5">Male</th>
              <th className="border border-gray-300 px-2 py-1.5">Female</th>
            </tr>
          </thead>
          <tbody>
            {MEASURES.map((measure) => (
              <>
                <tr key={measure.key} className={FORM_SECTION_BAND}>
                  <td colSpan={5} className={`border border-gray-300 px-2 py-1.5 font-semibold ${FORM_SECTION_BAND}`}>
                    {measure.heading}
                  </td>
                </tr>
                {FHSIS_BANDS.map((band, idx) => {
                  const c = counts[band.key as FhsisBandKey][measure.key];
                  // Infants have no facility/non-facility split on the form.
                  const hasSubRows = band.key !== 'infants';
                  const n = idx + 1;
                  return (
                    <>
                      <tr key={`${measure.key}-${band.key}`}>
                        <td className="border border-gray-300 px-2 py-1.5">
                          {band.key === 'infants'
                            ? `${n}. Infants 0-11 months old who had their first dental visit`
                            : `${n}. ${measure.caption(band.label)}`}
                        </td>
                        {cell(c.male)}
                        {cell(c.female)}
                        {cell(c.male + c.female)}
                        <td className="border border-gray-300 px-2 py-1.5" />
                      </tr>
                      {hasSubRows &&
                        (['a', 'b'] as const).map((suffix) => {
                          const sub = suffix === 'a' ? c.facility : c.nonFacility;
                          const unrecorded = c.unrecorded.male + c.unrecorded.female;
                          // Only render figures once SOMETHING in this cell was
                          // actually flagged. With every visit unflagged (all
                          // pre-Sprint-81 data) a "0" would be a false claim —
                          // "nobody had facility-based care" — where "—" is the
                          // true one: not recorded. A true 0 and an unfillable
                          // cell are different claims and the form shows them
                          // differently.
                          const anyFlagged = c.facility.male + c.facility.female + c.nonFacility.male + c.nonFacility.female > 0;
                          return (
                          <tr key={`${measure.key}-${band.key}-${suffix}`} className="text-muted-foreground">
                            <td className="border border-gray-300 px-2 py-1.5 pl-6">
                              {n}
                              {suffix}. {band.label} who{' '}
                              {measure.key === 'first' ? 'had their 1st visit' : 'completed 2 visits'} to a{' '}
                              {suffix === 'a' ? 'facility-based' : 'non-facility-based'} oral health care professional
                              within a year
                            </td>
                            {anyFlagged ? cell(sub.male) : blank(NO_FACILITY_FIELD)}
                            {anyFlagged ? cell(sub.female) : blank(NO_FACILITY_FIELD)}
                            {anyFlagged ? cell(sub.male + sub.female) : blank(NO_FACILITY_FIELD)}
                            <td className="border border-gray-300 px-2 py-1.5 text-[11px]">
                              {!anyFlagged
                                ? 'not recorded'
                                : unrecorded > 0
                                  // Says why a + b is short of the total, so the
                                  // gap reads as missing data and not as an
                                  // arithmetic error on a filed form.
                                  ? `${unrecorded} visit${unrecorded === 1 ? '' : 's'} not classified`
                                  : ''}
                            </td>
                          </tr>
                          );
                        })}
                    </>
                  );
                })}
              </>
            ))}

            {/* Pregnant women — on the form, no source in the system. */}
            <tr className={FORM_SECTION_BAND}>
              <td colSpan={5} className={`border border-gray-300 px-2 py-1.5 font-semibold ${FORM_SECTION_BAND}`}>
                PREGNANT WOMEN (by age group)
              </td>
            </tr>
            {MEASURES.map((measure) =>
              PREGNANT_AGE_GROUPS.map((group) => (
                <tr key={`preg-${measure.key}-${group}`} className="text-muted-foreground">
                  <td className="border border-gray-300 px-2 py-1.5">
                    6. Pregnant Women {group} who{' '}
                    {measure.key === 'first' ? 'had their 1st visit' : 'completed 2 visits'} to an oral health care
                    professional within a year
                  </td>
                  {blank(NO_PREGNANCY)}
                  {blank(NO_PREGNANCY)}
                  {blank(NO_PREGNANCY)}
                  <td className="border border-gray-300 px-2 py-1.5 text-[11px]">not recorded</td>
                </tr>
              )),
            )}
          </tbody>
        </table>

        <p className="mt-3 text-xs text-muted-foreground">
          Counts come from recorded preventive-care visits for the selected period. Cells marked “—” are left blank
          rather than estimated: pregnancy status has no field in this system at all, and a facility-based sub-row is
          blank when none of the visits counted in it were classified. Where some were, the sub-rows show real figures
          and Remarks states how many visits are unclassified — so the two sub-rows may add up to less than the total.
        </p>
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
};
