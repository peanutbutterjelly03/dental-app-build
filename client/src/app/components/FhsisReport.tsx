import { useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useFhsisData, FHSIS_BANDS, type FhsisBandKey, type Measure } from '../hooks/useFhsisData';
import { exportDohReportToPdf } from '../utils/exportPdf';
import { exportToXlsx } from '../utils/exportXlsx';
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

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  if (!y || !mo) return m;
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const FhsisReport = ({ schoolName }: { schoolName: string }) => {
  const [month, setMonth] = useState(thisMonth);
  const { counts, monthsWithData, loading, error } = useFhsisData(month, schoolName);
  const printableRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

  /** Filename stamped with school + month, so downloads are distinguishable
   *  once several months are filed. */
  const baseName = `FHSIS-SectionD_${(schoolName || 'All-Schools').replace(/[^\w]+/g, '-')}_${month}`;

  const onPdf = async () => {
    if (!printableRef.current) return;
    setBusy('pdf');
    try {
      await exportDohReportToPdf(printableRef.current, `${baseName}.pdf`);
    } finally {
      setBusy(null);
    }
  };

  // The Excel export writes the SAME cells the screen shows, "—" included, so
  // the downloaded workbook makes the identical claims as the report. Writing
  // 0 where the screen says "—" would quietly turn "not recorded" into
  // "examined none" the moment it left the app.
  const onXlsx = async () => {
    setBusy('xlsx');
    try {
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
      await exportToXlsx(
        rows,
        [
          { label: `Indicators — School: ${schoolName || 'All schools'} — Month: ${monthLabel(month)}`, value: (r) => r.indicator },
          { label: 'Male', value: (r) => r.male },
          { label: 'Female', value: (r) => r.female },
          { label: 'Total', value: (r) => r.total },
          { label: 'Remarks', value: (r) => r.remarks },
        ],
        `${baseName}.xlsx`,
        'FHSIS Section D',
      );
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>;
  }
  if (loading) return <SkeletonTable rows={12} />;

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
      {/* Controls — the month picker filters real data, not just the caption. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between fhsis-controls">
        <div className="flex flex-col gap-1">
          <label htmlFor="fhsis-month" className="text-xs font-medium text-muted-foreground">
            Reporting month
          </label>
          <input
            id="fhsis-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {monthsWithData.length > 0 && (
            <p className="mr-2 text-xs text-muted-foreground">
              Visits recorded in: {monthsWithData.slice(0, 6).map(monthLabel).join(', ')}
              {monthsWithData.length > 6 ? '…' : ''}
            </p>
          )}
          <button
            onClick={onPdf}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
          <button
            onClick={onXlsx}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Preparing…' : 'Excel'}
          </button>
        </div>
      </div>

      {/* ref is on the OUTER box so the School/Month header band and the section
          title are captured WITH the table. html2canvas clips to the ref'd
          element's own rendered box, so a banner placed outside it shows on
          screen and is silently missing from the PDF — the exact trap noted on
          the DOH Consolidated report. */}
      <div ref={printableRef} className="overflow-x-auto rounded-lg border border-gray-200 bg-card p-4">
        {/* Header band, as printed. */}
        <div className="mb-3 text-sm">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              <span className="font-semibold">School:</span> {schoolName || 'All schools'}
            </span>
            <span>
              <span className="font-semibold">Month:</span> {monthLabel(month)}
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
          Counts come from recorded preventive-care visits for the selected month. Cells marked “—” are left blank
          rather than estimated: pregnancy status has no field in this system at all, and a facility-based sub-row is
          blank when none of the visits counted in it were classified. Where some were, the sub-rows show real figures
          and Remarks states how many visits are unclassified — so the two sub-rows may add up to less than the total.
        </p>
      </div>
    </div>
  );
};
