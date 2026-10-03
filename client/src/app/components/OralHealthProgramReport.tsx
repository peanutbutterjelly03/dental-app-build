import { useMemo, useState, useRef, Fragment } from 'react';
import { useDohReportData } from '../hooks/useDohReportData';
import { SkeletonTable } from './Skeleton';
import { FORM_SECTION_BAND, BLOCKED_CELL, BLOCKED_TITLE, FORM_SUBROW_LABEL } from '../utils/dohFormStyle';
import { exportDohReportToPdf } from '../utils/exportPdf';
import { exportToXlsx } from '../utils/exportXlsx';
import { Download, FileSpreadsheet } from 'lucide-react';

/** What a no-source cell says in the exported workbook — the same mark the
 *  screen shows, so the file makes the identical claims as the report. */
const NO_SOURCE_MARK = '—';

// ─── Oral Health Program Reporting Form ──────────────────────────────────────
// Transcribed from the manuscript's APPENDIX F (the user said E; E is the
// Target Client List). Like Appendix E it is a low-resolution embedded scan,
// read by extracting the PNG and enlarging the header bands.
//
// The paper form aggregates by AGE BAND × SEX and covers the whole city
// population — preschool, school age, adolescent, adult, senior citizen and
// pregnant women. Floral only holds SCHOOL children (Kinder–Grade 10).
//
// An earlier version OMITTED the sections with no source, arguing that thirty
// blank columns would be unreadable. The user overruled that 2026-09-02: the
// form must carry the same rows and columns as the printed original, empty
// where there is nothing to report. A blank cell on a DOH form is meaningful,
// and a form missing columns is not the form.
//
// HONESTY: Oral Health Status rows are real, summed from the same source the
// DOH Consolidated report uses. Services Rendered became real in Sprint 90 —
// ⚠ THE OLD NOTE HERE ("shown but NOT populated") IS SUPERSEDED, and so is its
// reasoning. It said per-visit services are recorded nowhere because
// PREVENTIVE_CARE_RECORD stores only `iptr_id`, `visit_date` and
// `visit_number`. True, and beside the point: the services were on
// TOOTH_RECORD.treatment_code the whole time, reachable through
// DENTAL_CHART.iptr_id. What genuinely has no source is narrower —
// Oral Health Counselling and Root Surface Protection have no treatment code
// in the system, so those two rows still print "—" on purpose.

const AGE_BANDS = ['4 yrs & below', '5-9 yrs', '10-14 yrs', '15-19 yrs', '20 yrs & above'] as const;
type AgeBand = typeof AGE_BANDS[number];

// ─── The paper form's full column set ────────────────────────────────────────
// Every column and row the printed form carries is rendered, even where Floral
// can never fill it — the form is the form, and a blank cell on it is
// meaningful (CLAUDE.md, NOTHING COSMETIC). This replaces an earlier version
// that omitted the adult, senior-citizen and pregnant-women sections.
//
// `band` maps a column to one of the five age brackets the system actually
// computes. A column with NO band has no source at that granularity — the
// system records a birthdate, not an age in months, and records no pregnancy
// at all — so it renders "—" rather than a 0 it cannot stand behind.
//
// ⚠ ALL captions here were RESOLVED 2026-09-02 against the machine-readable DOH
// workbook the user supplied (TCLForm2andFHSISReport.xlsx, sheet "2026 Form 2",
// rows 3-5) -- the authoritative source that replaced the low-resolution
// Appendix F scan. No `unverified` flags remain in the column list. Corrections:
// "0-6 mos" -> "0-8 mos"; "Total (Infants)" -> "Total (0-11 mos)"; "5 y/o" ->
// "5 yrs old"; "5-9 y/o" -> "Total (5 - 9 yrs old)"; "Total Adult" -> "Total
// Other Adults"; "60 y/o and above" -> "60 yrs & Above"; and the pregnant-women
// band ends at 49, NOT 59 -- "20-59 y/o" was simply wrong.
//
// ⚠ STILL DIFFERENT FROM THE REAL FORM, and NOT a caption issue: the workbook
// groups columns as Infants (0-11 mos) / Under Five Children / School Age
// Children / Adolescent / Other Adults, where this table uses UNDER FIVE
// CHILDREN / CHILDREN ABOVE 5 / ADULT / SENIOR CITIZEN. It also carries a
// "6 - 9 yrs old" column this table lacks. Group names and missing columns are
// structural; they belong with the missing-columns work.
//
// Original note follows.
// ⚠ `unverified` marks a caption read off a LOW-RESOLUTION scan of Appendix F
// that could not be made out with confidence. They are shown with a dotted
// underline and listed under the table, because an invented caption on a form
// submitted to the City Health Office is a placeholder. CHECK THESE AGAINST THE
// PAPER FORM and clear the flag — the same standing task as the DOH spelling
// check (Transfussion/Scalling/Flouride).
type Col = { group: string; label: string; band?: AgeBand; total?: AgeBand[]; unverified?: boolean };

const COLUMNS: Col[] = [
  { group: 'UNDER FIVE CHILDREN', label: '0-8 mos' },
  { group: 'UNDER FIVE CHILDREN', label: '9-11 mos' },
  { group: 'UNDER FIVE CHILDREN', label: 'Total (0-11 mos)' },
  { group: 'UNDER FIVE CHILDREN', label: '1' },
  { group: 'UNDER FIVE CHILDREN', label: '2' },
  { group: 'UNDER FIVE CHILDREN', label: '3' },
  { group: 'UNDER FIVE CHILDREN', label: '4' },
  { group: 'UNDER FIVE CHILDREN', label: 'Total (Under 5)', total: ['4 yrs & below'] },

  { group: 'CHILDREN ABOVE 5', label: '5 yrs old' },
  { group: 'CHILDREN ABOVE 5', label: 'Total (5 - 9 yrs old)', band: '5-9 yrs' },
  { group: 'CHILDREN ABOVE 5', label: 'Total Children', total: ['5-9 yrs'] },

  { group: 'ADOLESCENT', label: '10-14 y/o', band: '10-14 yrs' },
  { group: 'ADOLESCENT', label: '15-19 y/o', band: '15-19 yrs' },
  { group: 'ADOLESCENT', label: 'Total Adolescent', total: ['10-14 yrs', '15-19 yrs'] },

  { group: 'ADULT', label: '20-59 yrs old', band: '20 yrs & above' },
  { group: 'SENIOR CITIZEN', label: '60 yrs & Above' },
  { group: 'ADULT', label: 'Total Other Adults', total: ['20 yrs & above'] },

  // No source at all: the system records no pregnancy status.
  { group: 'PREGNANT WOMEN', label: '10-14 yrs old' },
  { group: 'PREGNANT WOMEN', label: '15-19 yrs old' },
  { group: 'PREGNANT WOMEN', label: '20-49 yrs old' },
  { group: 'PREGNANT WOMEN', label: 'Total AP' },

  { group: 'TOTAL ALL AGES', label: 'Total All Ages', total: [...AGE_BANDS] },
];

/** Group bands in column order, with their spans. */
const GROUPS = COLUMNS.reduce<{ label: string; span: number }[]>((acc, c) => {
  const last = acc[acc.length - 1];
  if (last && last.label === c.group) last.span += 1;
  else acc.push({ label: c.group, span: 1 });
  return acc;
}, []);

const UNVERIFIED_COUNT = COLUMNS.filter((c) => c.unverified).length;

const SEXES = ['M', 'F'] as const;

/** Indicator rows. `field` maps to useDohReportData's real fields; a null
 *  field means the paper form has the row but the system has no source. */
type Row = {
  /** Unique key — NOT the label. Sub-row captions repeat across parents
   *  ("Head Count" appears under ART, Sealants, Root Surface Protection and
   *  Tooth Extraction), so keying on the label would collide in React and in
   *  the hidden-rows set. */
  key: string;
  label: string;
  field: string | null;
  indent?: boolean;
  /** The paper form BLOCKS these cells out in solid dark grey — they must not
   *  be filled at all. Distinct from `field: null`, which means the form wants
   *  a number and this system has no source for it. Conflating the two would
   *  claim the form forbids a cell it merely leaves empty. */
  blocked?: boolean;
  /** ⚠ FORM-MANDATED SUB-ROWS, AND THEY ARE ALWAYS SHOWN (Sprint 89).
   *
   *  On the printed form these indicators do not have cells of their own: the
   *  indicator column is split in two, the label spans the group, and each
   *  sub-row carries its own line of values — "OP / Scaling" over
   *  "1st Scaling / 2nd Scaling", "ART" over "Head Count / Tooth Count".
   *
   *  This REPLACES the old collapsible `children`, which was a convenience
   *  split (ART by restorative material) the reader could fold away. These are
   *  part of the form, so they are not collapsible: hiding one would file a
   *  form with a missing line. A parent carrying sub-rows renders NO values
   *  itself — its `field` is meaningless and stays null. */
  subRows?: Row[];
};

/** Section A of the paper form. Read off Appendix F (`image18`) on 2026-09-03
 *  — the app carried NONE of these four rows, so a whole printed section was
 *  missing from a form filed with the City Health Office.
 *
 *  All four have real sources: the facility split is Sprint 81's
 *  `facility_based` on the first visit, and the two RPOC rows are the visit
 *  numbers the RPC module has always recorded. */
const UTILIZATION_ROWS: Row[] = [
  { key: 'visit_facility_1st', label: 'No. of patients who visited the DENTAL FACILITY for the 1st time', field: 'visit_facility_1st' },
  { key: 'visit_nonfacility_1st', label: 'No. of patients who visited NON-FACILITY for the 1st time', field: 'visit_nonfacility_1st' },
  { key: 'rpoc_visit1', label: 'No. of Patients who availed the Routine Preventive Oral Care (RPOC) - 1ST VISIT', field: 'rpoc_visit1' },
  { key: 'rpoc_visit2', label: 'No. of Patients who availed the Routine Preventive Oral Care (RPOC) - 2ND VISIT', field: 'rpoc_visit2' },
];

const STATUS_ROWS: Row[] = [
  { key: 'caries', label: 'Number of patients with Dental Caries', field: 'DMF_total' },
  // ONE row on the paper form, not two. Counted as "debris OR calculus" in
  // useDohReportData rather than by adding the two separate tallies, which
  // would double-count every patient who has both.
  // ⚠ "Calcular", not "Calculus" — the filed form's own wording (Sprint 89,
  // read off the January 2026 return). Same rule as the other DOH spellings.
  { key: 'debris_or_calculus', label: 'Number of patients with Oral Debris / Calcular Deposits', field: 'debris_or_calculus' },
  { key: 'gingivitis', label: 'Number of patients with Gingivitis', field: 'gingivitis' },
  // Was absent although ORAL_HEALTH_CONDITION has carried the boolean all
  // along — it was simply never mapped in useDohReportData.
  { key: 'periodontitis', label: 'Number of patients with Periodontitis', field: 'periodontitis' },
  { key: 'lesions', label: 'Number of patients w/ suspected oral lesions', field: 'anomaly' },
  // On the form, and structurally impossible here: this table covers school
  // children and carries no adult or elderly column at all. Blocked (dark
  // grey) rather than "—" — the form itself blocks these cells, which is a
  // different statement from "we have no data".
  { key: 'edentulous', label: 'Number of Completely Edentulous Adults / Elderly', field: null, blocked: true },
  { key: 'ofc_exam', label: 'OFC Upon Oral Examination', field: 'ofc_exam' },
  // No completed mouth rehabilitation is recorded anywhere, so this is a
  // genuine no-source row, not a blocked one.
  { key: 'ofc_rehab', label: 'OFC Upon Complete Oral Rehabilitation', field: null },
];

/** Section C, TRANSCRIBED FROM THE FILED FORM (Sprint 89).
 *
 *  ⚠ The source here is the **January 2026 return the clinic actually filed**
 *  (`Jan_2026_ORAL_HEALTH_PROGRAM_REPORTING_FORM.pdf`, signed, one page per
 *  school), not Appendix F and NOT the `2026 Form 2` sheet in the DOH
 *  workbook. **The workbook is a DIFFERENT form** with a different row set
 *  (it separates Oral Debris from Calcular Deposits, adds Caries Free, Total
 *  dfx/DMFX breakdowns and a Gum Treatment row). Sprint 84 made the workbook
 *  authoritative for the TARGET CLIENT LIST; it is not authoritative here.
 *  The filed return is.
 *
 *  Six of these nine indicators carry the form's own two-line split, and four
 *  of them are Head Count / Tooth Count — the same head-vs-tooth distinction
 *  Sprint 88's summary sheet turns on.
 *
 *  ⚠ REMOVED, deliberately: "Number of patients given Permanent Filling" —
 *  it is NOT on the filed form. Also removed: the ART → Glass Ionomer /
 *  Composite split, which was a convenience breakdown that showed dashes
 *  anyway; the form splits ART by Head Count / Tooth Count instead. The
 *  material a filling used is still recorded on the dental chart. */
const SERVICE_ROWS: Row[] = [
  { key: 'examined', label: 'Number of patients Examined / given Oral Examination', field: 'examined' },
  { key: 'counselling', label: 'Number of patients provided with Oral Health Counselling', field: null },
  {
    key: 'op_scaling',
    label: 'Number of patients given OP / Scaling',
    field: null,
    subRows: [
      { key: 'op_scaling_1st', label: '1st Scaling', field: 'op_scaling_1st' },
      { key: 'op_scaling_2nd', label: '2nd Scaling', field: 'op_scaling_2nd' },
    ],
  },
  {
    key: 'fluoride',
    label: 'Number of patients given Fluoride Varnish',
    field: null,
    subRows: [
      { key: 'fluoride_1st', label: '1st Application', field: 'fv_1st' },
      { key: 'fluoride_2nd', label: '2nd Application', field: 'fv_2nd' },
    ],
  },
  {
    key: 'sdf',
    label: 'Number of patients given Silver Diamine Fluoride (SDF)',
    field: null,
    subRows: [
      { key: 'sdf_1st', label: '1st Application', field: 'sdf_1st' },
      { key: 'sdf_2nd', label: '2nd Application', field: 'sdf_2nd' },
    ],
  },
  {
    key: 'art',
    label: 'Number of patients given ART',
    field: null,
    subRows: [
      { key: 'art_head', label: 'Head Count', field: 'art_head' },
      { key: 'art_tooth', label: 'Tooth Count', field: 'art_tooth' },
    ],
  },
  {
    key: 'sealants',
    label: 'Number of patients given Sealants',
    field: null,
    subRows: [
      { key: 'sealants_head', label: 'Head Count', field: 'sealant_head' },
      { key: 'sealants_tooth', label: 'Tooth Count', field: 'sealant_tooth' },
    ],
  },
  {
    // "patient", singular, is the form's own wording — left as printed.
    key: 'rsp',
    label: 'Number of patient given Root Surface Protection',
    field: null,
    subRows: [
      { key: 'rsp_head', label: 'Head Count', field: null },
      { key: 'rsp_tooth', label: 'Tooth Count', field: null },
    ],
  },
  {
    key: 'extraction',
    label: 'Number of patients who had Tooth Extraction',
    field: null,
    subRows: [
      { key: 'extraction_head', label: 'Head Count', field: 'extraction_head' },
      { key: 'extraction_tooth', label: 'Tooth Count', field: 'extraction_tooth' },
    ],
  },
];

/** The form's fourth band. ⚠ It is titled "Other Procedures" and carries NO
 *  letter, where A/B/C do — the app previously invented "D. Other Parameters".
 *  The three a/b/c referral rows and the prescriptions row were missing
 *  entirely. */
const OTHER_ROWS: Row[] = [
  { key: 'ref_primary', label: 'No. of patients referred to other Primary Care Facilities', field: null },
  { key: 'ref_higher', label: 'Total no. of patients referred to Higher Level of Care', field: null },
  { key: 'ref_cancer', label: 'a. No. of patients for Oral Cancer Screening Referrals', field: null, indent: true },
  { key: 'ref_surgical', label: 'b. No. of patients for Surgical Procedures', field: null, indent: true },
  { key: 'ref_private', label: 'c. No. of Referrals to Private Facilities', field: null, indent: true },
  { key: 'prescriptions', label: 'No. of patients given Dental Prescriptions', field: null },
];

/** Stable key for a column — group + label, since labels repeat across groups
 *  (both Adolescent and Pregnant Women carry "10-14 y/o"). */
const colKey = (c: Col) => `${c.group}|${c.label}`;

function loadSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export const OralHealthProgramReport = ({ schoolYear = null, schoolName = null }: { schoolYear?: string | null; schoolName?: string | null }) => {
  // Scoped to the SAME school the DOH tab's picker selects, not the sidebar's
  // current school — the two are different controls and this form is read
  // beside the consolidated report.
  const { getRealTotal, loading } = useDohReportData(schoolYear, schoolName);

  // Hidden rows/columns and expanded parents, remembered per browser.
  //
  // ⚠ Hiding CHANGES THE OUTPUT, not just the view — the dentist asked for
  // that explicitly ("so report can change content ... like excels"). A print
  // of this form therefore may not be the complete standard form, so the note
  // under the table NAMES what is hidden. An incomplete form that looks
  // complete is the failure mode worth preventing.
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => loadSet('ohprf-hidden-rows'));
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => loadSet('ohprf-hidden-cols'));
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  // Wraps only the table, so the PDF carries the form and not the toolbar.
  const printableRef = useRef<HTMLDivElement>(null);

  const persist = (key: string, next: Set<string>) => {
    try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };
  const visibleCols = COLUMNS.filter((c) => !hiddenCols.has(colKey(c)));
  // Recomputed from what is actually shown — a group band spanning hidden
  // columns would push the whole header out of alignment with its body.
  const visibleGroups = visibleCols.reduce<{ label: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last && last.label === c.group) last.span += 1;
    else acc.push({ label: c.group, span: 1 });
    return acc;
  }, []);
  const hiddenCount = hiddenRows.size + hiddenCols.size;
  const rowVisible = (r: Row) => !hiddenRows.has(r.key);

  // The form's columns are age × sex only. This reads the hook's across-all-
  // grades total rather than summing getRealCount over a grade list: that sum
  // silently dropped any record whose grade was never stored (school years
  // before Sprint 57a), which on a submitted form is an undercount of real
  // patients.
  /** One cell: a mapped band, a computed total, or "—" where the system has
   *  no source at that granularity. Never 0-as-a-guess. */
  const cell = useMemo(() => (field: string | null, col: Col, sex: 'M' | 'F'): number | null => {
    if (!field) return null;
    if (col.total) return col.total.reduce((sum, b) => sum + (getRealTotal(b, sex, field) ?? 0), 0);
    if (col.band) return getRealTotal(col.band, sex, field) ?? 0;
    return null;
  }, [getRealTotal]);

  const rowTotal = (field: string | null) => {
    if (!field) return null;
    let t = 0;
    for (const b of AGE_BANDS) for (const s of SEXES) t += getRealTotal(b, s, field) ?? 0;
    return t;
  };

  if (loading) return <SkeletonTable rows={10} />;

  const th = 'px-2 py-2 text-[11px] font-semibold text-foreground border border-border whitespace-nowrap';
  const td = 'px-2 py-1.5 text-xs text-foreground border border-border text-center tabular-nums';
  const labelTd = 'px-2 py-1.5 text-xs text-foreground border border-border whitespace-nowrap text-left';

  const section = (title: string) => (
    // Amber band across the full width, as printed — was bg-amber-50, a tint
    // so light the sections read as ordinary rows.
    // Band painted on the TD, not only the TR: html2canvas (the PDF export
    // path) resolves cell backgrounds reliably and row backgrounds not always,
    // so a tr-only fill can vanish from the exported form.
    <tr className={FORM_SECTION_BAND}>
      <td className={`${labelTd} font-bold ${FORM_SECTION_BAND}`} colSpan={visibleCols.length * 2 + 3}>{title}</td>
    </tr>
  );

  /** The value cells for one line — every age/sex column plus the grand total.
   *  Shared by plain rows and sub-rows, which carry identical value grids. */
  const valueCells = (r: Row) => (
    <>
      {visibleCols.map((c) => SEXES.map((s) => {
        const v = cell(r.field, c, s);
        return (
          // A blocked cell carries no value and no dash — the paper form fills
          // it solid, meaning "do not write here". `—` would invite a number.
          r.blocked ? (
            <td key={`${c.group}-${c.label}-${s}`} className={`${td} ${BLOCKED_CELL}`} title={BLOCKED_TITLE} />
          ) : (
          <td key={`${c.group}-${c.label}-${s}`} className={`${td} ${v === null ? 'text-muted-foreground' : ''}`}>
            {v === null ? '—' : v}
          </td>
          )
        );
      }))}
      {r.blocked ? (
        <td className={`${td} ${BLOCKED_CELL}`} title={BLOCKED_TITLE} />
      ) : (
      <td className={`${td} font-semibold bg-gray-50`}>
        {rowTotal(r.field) === null ? <span className="text-muted-foreground">—</span> : rowTotal(r.field)}
      </td>
      )}
    </>
  );

  const renderRow = (r: Row): React.ReactNode => {
    if (!rowVisible(r)) return null;

    // An indicator with the form's own two-line split: the label spans its
    // sub-rows and carries NO values of its own, exactly as printed. The
    // sub-rows are not collapsible — they are part of the form.
    if (r.subRows) {
      return (
        <Fragment key={r.key}>
          {r.subRows.map((sub, i) => (
            <tr key={sub.key} className="hover:bg-gray-50">
              {i === 0 && (
                <td className={`${labelTd} align-middle`} rowSpan={r.subRows!.length}>{r.label}</td>
              )}
              <td className={`${labelTd} ${FORM_SUBROW_LABEL} text-[11px]`}>{sub.label}</td>
              {valueCells(sub)}
            </tr>
          ))}
        </Fragment>
      );
    }

    // A plain indicator spans both label columns, as the form does.
    return (
      <tr key={r.key} className="hover:bg-gray-50">
        <td className={`${labelTd} ${r.indent ? 'pl-6' : ''}`} colSpan={2}>{r.label}</td>
        {valueCells(r)}
      </tr>
    );
  };

  const exportBaseName = `OHPRF_${(schoolName ?? 'All Schools').replace(/[^\w]+/g, '-')}_${schoolYear ?? 'all-years'}`;

  const onPdf = async () => {
    if (!printableRef.current) return;
    setBusy('pdf');
    try {
      await exportDohReportToPdf(printableRef.current, `${exportBaseName}.pdf`);
    } finally {
      setBusy(null);
    }
  };

  // One row per indicator, one column per age-band/sex cell — the shape of the
  // printed form. Writes exactly what the screen shows, "—" included: turning a
  // "—" into 0 in the workbook would convert "no source" into "none found" the
  // moment the file left the app. Blocked cells stay EMPTY, since the form
  // forbids writing in them at all.
  const onXlsx = async () => {
    setBusy('xlsx');
    try {
      // The workbook mirrors the form's TWO label columns, so a sub-row keeps
      // its parent's name beside it — "ART | Tooth Count" reads correctly in a
      // spreadsheet, where an indented orphan "Tooth Count" would not.
      type XRow = { section: string; indicator: string; sub: string; cells: (string | number)[]; total: string | number };
      const rows: XRow[] = [];
      const push = (section: string, list: Row[]) => {
        for (const r of list) {
          if (!rowVisible(r)) continue;
          const emit = (row: Row, indicator: string, sub: string) => {
            rows.push({
              section,
              indicator,
              sub,
              cells: visibleCols.flatMap((c) => SEXES.map((s) => {
                if (row.blocked) return '';
                const v = cell(row.field, c, s);
                return v === null ? NO_SOURCE_MARK : v;
              })),
              total: row.blocked ? '' : (rowTotal(row.field) ?? NO_SOURCE_MARK),
            });
          };
          // A parent with sub-rows has no values of its own on the form, so it
          // contributes no row of its own here either.
          if (r.subRows) for (const sub of r.subRows) emit(sub, r.label, sub.label);
          else emit(r, r.label, '');
        }
      };
      push('A. Patient Seeking Behaviour', UTILIZATION_ROWS);
      push('B. Oral Health Status', STATUS_ROWS);
      push('C. Services Rendered', SERVICE_ROWS);
      push('Other Procedures', OTHER_ROWS);

      const cols = [
        { label: 'Section', value: (r: XRow) => r.section },
        { label: 'Indicator', value: (r: XRow) => r.indicator },
        { label: '', value: (r: XRow) => r.sub },
        ...visibleCols.flatMap((c, ci) => SEXES.map((s, si) => ({
          label: `${c.group} · ${c.label} · ${s}`,
          value: (r: XRow) => r.cells[ci * SEXES.length + si] ?? '',
        }))),
        { label: 'Grand Total', value: (r: XRow) => r.total },
      ];
      await exportToXlsx(rows, cols, `${exportBaseName}.xlsx`, 'Program Report');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">Oral Health Program Reporting Form</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {/* Names the scope the FIGURES actually cover. Falling back to the
                sidebar's current school here would label all-schools data with
                one school's name — the exact mislabelling this sprint fixes. */}
            {schoolName ?? 'All schools'} · Barangay Tanyag, Taguig City
          </span>
          {/* The period now comes from the DOH tab's school-year picker, which
              this form shares (Sprint 57b). Before that the hook took no date
              range at all and this said so rather than offering a control that
              silently did nothing. */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {schoolYear ? `School year ${schoolYear}` : 'All years to date'}
            </span>
            {/* PDF *and* Excel here, unlike the Target Client List: this form
                is aggregate counts with no patient names, so it carries none
                of the TCL's PII weight, and its width is bounded. */}
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
            <button
              onClick={() => setShowPicker((v) => !v)}
              aria-expanded={showPicker}
              className="text-xs px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50"
            >
              {showPicker ? 'Done' : `Rows & columns${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          The paper form covers the whole city population; Floral holds school children only, so its
          <span className="font-medium text-foreground"> adult, senior citizen and pregnant-women </span>
          columns stay empty here. Rows marked
          <span className="font-semibold text-foreground"> — </span>
          exist on the form but have no source in the system yet: per-visit services are not recorded, only visit dates.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Every column and row of the paper form is shown, including those a school clinic can never fill —
          a blank cell on this form is meaningful. Cells read <span className="font-semibold text-foreground">—</span>{' '}
          where the system has no source at that granularity: it records a birthdate, not an age in months,
          and records no pregnancy at all.
          {hiddenCount > 0 && (
            <> <span className="font-semibold text-foreground">This form is not the complete standard form:</span>{' '}
            {hiddenRows.size} row{hiddenRows.size === 1 ? '' : 's'} and {hiddenCols.size} column
            {hiddenCols.size === 1 ? '' : 's'} are hidden, and hidden items do not print.</>
          )}
          {UNVERIFIED_COUNT > 0 && (
            <> <span className="border-b border-dotted border-amber-500">Dotted</span> column captions
            ({UNVERIFIED_COUNT}) were read from a low-resolution scan of Appendix F and still need checking
            against the paper form — they are marked rather than silently trusted.</>
          )}
        </p>
      </div>

      {showPicker && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3 text-xs">
          <p className="text-muted-foreground">
            Untick to hide. Hiding changes what is <span className="font-medium text-foreground">printed</span>,
            not just what is on screen — the note under the table records anything hidden, so a shortened form
            is never mistaken for the complete one.
          </p>
          <div>
            <div className="font-semibold text-foreground mb-1.5">Columns</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {COLUMNS.map((c) => (
                <label key={colKey(c)} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(colKey(c))}
                    onChange={() => setHiddenCols((p) => { const n = toggle(p, colKey(c)); persist('ohprf-hidden-cols', n); return n; })}
                    className="w-3.5 h-3.5 rounded accent-primary"
                  />
                  <span className="truncate" title={`${c.group} · ${c.label}`}>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold text-foreground mb-1.5">Rows</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {[...UTILIZATION_ROWS, ...STATUS_ROWS, ...SERVICE_ROWS, ...OTHER_ROWS].map((r) => (
                <label key={r.key} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenRows.has(r.key)}
                    onChange={() => setHiddenRows((p) => { const n = toggle(p, r.key); persist('ohprf-hidden-rows', n); return n; })}
                    className="w-3.5 h-3.5 rounded accent-primary"
                  />
                  <span className="truncate" title={r.label}>{r.label}</span>
                </label>
              ))}
            </div>
          </div>
          {hiddenCount > 0 && (
            <button
              onClick={() => {
                setHiddenRows(new Set()); persist('ohprf-hidden-rows', new Set());
                setHiddenCols(new Set()); persist('ohprf-hidden-cols', new Set());
              }}
              className="px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50"
            >Show everything</button>
          )}
        </div>
      )}

      <div ref={printableRef} className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="border-collapse w-full">
          <thead className="bg-gray-50">
            {/* Three header levels, matching the paper form: population group
                → age column → M/F. This file previously had only the lower two,
                which made the band a third of its printed height and dropped
                the grouping that tells a reader why the age columns are cut
                where they are. Only the groups Floral can actually populate are
                rendered — see the note above about the adult / senior citizen /
                pregnant-women sections. */}
            <tr>
              <th className={`${th} text-left align-bottom`} rowSpan={3} colSpan={2}>INDICATORS</th>
              {visibleGroups.map((g, i) => (
                <th key={`${g.label}-${i}`} className={`${th} bg-gray-100`} colSpan={g.span * SEXES.length}>
                  {g.label}
                </th>
              ))}
              <th className={`${th} align-bottom`} rowSpan={3}>Grand<br />Total</th>
            </tr>
            <tr>
              {visibleCols.map((c, i) => (
                <th key={`${c.label}-${i}`} className={th} colSpan={2}>
                  {/* Dotted underline marks a caption read off the low-res scan
                      that still needs checking against the paper form. */}
                  <span className={c.unverified ? 'border-b border-dotted border-amber-500' : ''}
                        title={c.unverified ? 'Caption unverified — check against the paper DOH form' : undefined}>
                    {c.label}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {visibleCols.map((c, i) => SEXES.map((s) => (
                <th key={`${c.label}-${i}-${s}`} className={`${th} w-10`}>{s}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {/* Lettered A–D, as the paper form numbers them. The app used
                I/II/III and was missing section A entirely. */}
            {section('A. Patient Seeking Behaviour')}
            {UTILIZATION_ROWS.map(renderRow)}
            {section('B. Oral Health Status')}
            {STATUS_ROWS.map(renderRow)}
            {section('C. Services Rendered')}
            {SERVICE_ROWS.map(renderRow)}
            {section('Other Procedures')}
            {OTHER_ROWS.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
};
