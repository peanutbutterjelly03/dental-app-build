import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, FileBarChart, FileSpreadsheet, FileText, AlertTriangle, AlertCircle, CheckCircle, Users, Calendar, CalendarDays, CalendarRange, GraduationCap, UserRound, VenusAndMars, SlidersHorizontal, Stethoscope, Activity, LayoutDashboard, X } from 'lucide-react';
import { PeriodDatesBoxes, type PeriodDatesValue } from './PeriodDatesBoxes';
import { ExportMenu, PeriodTiles, PeriodSwitch, fieldInputClass, PanelShell, PanelRow, BOX_W, UnderlineTabs, GroupBox, Underlined, FiltersButton, FilterChip, type TileOption } from './ReportControls';
import { RangePicker } from './RangePicker';
import { buildXlsx, buildSheetsXlsx } from '../utils/exportXlsx';
import { downloadBlob } from '../utils/exportCsv';
import { toLocalDateString } from '../utils/localDate';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { useAuth } from '../context/AuthContext';
import { getSchoolShortName, getSchoolAcronym } from '../utils/schoolColors';
import { CHART } from '../utils/chartColors';
import { GradePill } from './GradePill';
import { useDohReportData } from '../hooks/useDohReportData';
import { buildDohReportPdf } from '../utils/exportPdf';
import { buildDohReportXlsx } from '../utils/exportDohXlsx';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { useGridScroll } from '../hooks/useGridScroll';
import { GridEdgeButtons } from './GridEdgeButtons';
import { PreviewModal } from './PreviewModal';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { apiClient } from '../api/client';
import type { ReferralType } from '../api/types';
import type { ReportsPanelsOutput } from '../../../shared/reportsPanels';
import { useStudents } from '../hooks/useStudents';
import { TargetClientList } from './TargetClientList';
import { OralHealthProgramReport } from './OralHealthProgramReport';
import { SchoolSummaryReport } from './SchoolSummaryReport';
import { FhsisReport } from './FhsisReport';
import { ConsentForm } from './ConsentForm';
import { treatmentCodes } from '../utils/dentalChartCodes';
import { schoolYearLabel } from '../utils/schoolYear';
import { formatDate } from '../utils/localDate';
import { useSchools } from '../hooks/useSchools';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Age brackets per grade — exact DOH format
const GRADE_BRACKETS: Record<string, {label:string; ages:string[]}> = {
  'Kinder':  { label:'KINDER',   ages:['4 yrs & below','5-9 yrs'] },
  'Grade 1': { label:'GRADE 1',  ages:['4 yrs & below','5-9 yrs','10-14 yrs','15-19 yrs'] },
  'Grade 2': { label:'GRADE 2',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 3': { label:'GRADE 3',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 4': { label:'GRADE 4',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 5': { label:'GRADE 5',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 6': { label:'GRADE 6',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  // Secondary carries the SAME four brackets as Grades 2-6. Sprint 41 first
  // dropped "5-9 yrs" here on the reasoning that a Grade 7 student is ~12 so
  // the cell can never be filled — but that argument proves too much: a Grade
  // 2 student is never 20 either, and the form still carries "20 yrs & above"
  // for Grade 2. The DOH form uses a uniform bracket set per grade regardless
  // of which cells are plausible, so a shortened secondary set was the odd
  // one out. Corrected 2026-09-01.
  // ⚠ Still unconfirmed against the actual paper DOH secondary form — this is
  // now an argument from the form's own internal consistency, not a reading of
  // it. If the real form differs, only these four lines change.
  'Grade 7': { label:'GRADE 7',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 8': { label:'GRADE 8',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 9': { label:'GRADE 9',  ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
  'Grade 10':{ label:'GRADE 10', ages:['5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'] },
};

// The SAME DOH form, run over two grade bands. Only Bagong Tanyag Integrated
// School has a secondary section (K-G10); the other two stop at G6, which is
// why the band selector hides itself rather than offering an always-empty table.
const ELEM_GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'];
const HS_GRADES = ['Grade 7','Grade 8','Grade 9','Grade 10'];
type GradeBand = 'elem' | 'hs';

// Summary age brackets (rightmost columns)
const SUMMARY_BRACKETS = ['4 yrs & below','5-9 yrs','10-14 yrs','15-19 yrs','20 yrs & above'];

// Cell display — blank if zero
const cell = (v: number) => v === 0 ? '' : String(v);

type RowDef =
  | { type: 'header'; label: string }
  | { type: 'data';   label: string; field: string; indent?: boolean }
  | { type: 'sub';    label: string; field: string };

const DOH_ROWS: RowDef[] = [
  { type:'data', label:'No. of Person Attended',   field:'attended'  },
  { type:'data', label:'No. Orally Examined',       field:'examined'  },

  { type:'header', label:'Medical History Status' },
  { type:'data', label:'Total No. with Allergies',                                  field:'allergies',      indent:true },
  { type:'data', label:'Total No. with Hypertension/ CVA',                          field:'hypertension',   indent:true },
  { type:'data', label:'Total No. with Diabetes Mellitus',                          field:'diabetes',       indent:true },
  { type:'data', label:'Total No. with Blood Disorders',                             field:'bloodDisorders', indent:true },
  { type:'data', label:'Total No. with Cardiovascular/ Heart Diseases',             field:'cardiovascular', indent:true },
  { type:'data', label:'Total No. with Thyroid Disorders',                          field:'thyroid',        indent:true },
  { type:'data', label:'Total No. with Hepatitis',                                  field:'hepatitis',      indent:true },
  { type:'data', label:'Total No. with Malignancy',                                 field:'malignancy',     indent:true },
  { type:'data', label:'Total No. with History of Previous Hospitalization',        field:'hospitalization',indent:true },
  { type:'data', label:'Total No. with Blood Transfussion',                         field:'bloodTransfusion',indent:true},
  { type:'data', label:'Total No. with Tattoo',                                     field:'tattoo',         indent:true },

  { type:'header', label:'Dietary/ Social History Status' },
  { type:'data', label:'Total No of Sugar Sweetened Beverages / Food Drinker/ Eater', field:'sugarSweetened', indent:true },
  { type:'data', label:'Total No of Alcoholic Drinker',                             field:'alcoholDrinker', indent:true },
  { type:'data', label:'Total No of Tobacco User',                                  field:'tobaccoUser',    indent:true },
  { type:'data', label:'Total No of Betel Nut Chewer',                              field:'betelNut',       indent:true },

  { type:'header', label:'Oral Health Status' },
  { type:'data', label:'Total No. with Dental Caries',                              field:'dentalCaries',   indent:true },
  { type:'data', label:'Total No. of Edentulous/ No Dentition',                     field:'edentulous',     indent:true },
  { type:'data', label:'Total No. with Gingivitis/Perio Disease',                   field:'gingivitis',     indent:true },
  { type:'data', label:'Total No. with Oral Debris',                                field:'debris',         indent:true },
  { type:'data', label:'Total No. with Calcular Deposit',                           field:'calculus',       indent:true },
  { type:'data', label:'Total No. with Dento-Facial Anomaly',                       field:'anomaly',        indent:true },
  { type:'data', label:'Total df',                                                   field:'dmf_df',         indent:true },
  { type:'data', label:'Total decayed (d)',                                          field:'dmf_d',          indent:true },
  { type:'data', label:'Total filled (f)',                                           field:'dmf_f',          indent:true },
  { type:'data', label:'Total DMF',                                                  field:'DMF_total',      indent:true },
  { type:'data', label:'Total Decayed (D)',                                          field:'DMF_D',          indent:true },
  { type:'data', label:'Total Missing (M)',                                          field:'DMF_M',          indent:true },
  { type:'data', label:'Total Filled (F)',                                           field:'DMF_F',          indent:true },

  { type:'header', label:'Services Rendered' },
  { type:'data', label:'No. Provided BOHC',                                          field:'bohc',           indent:true },
  { type:'sub',  label:'Health Center',                                              field:'bohc_hc'         },
  { type:'sub',  label:'Outreach',                                                   field:'bohc_out'        },
  { type:'sub',  label:'Schools',                                                    field:'bohc_sch'        },
  { type:'data', label:'No. Given OP/Scalling',                                      field:'oph_scaling',    indent:true },
  { type:'data', label:'No. Given Permanent Fillings',                               field:'fill_perm',      indent:true },
  { type:'sub',  label:'Head count',                                                 field:'fill_perm_head'  },
  { type:'sub',  label:'Tooth count',                                                field:'fill_perm_tooth' },
  { type:'data', label:'No. Given Temporary Fillings',                               field:'fill_temp',      indent:true },
  { type:'sub',  label:'Head count',                                                 field:'fill_temp_head'  },
  { type:'sub',  label:'Tooth count',                                                field:'fill_temp_tooth' },
  { type:'data', label:'No. Given Gum Treatment',                                    field:'gum_treatment',  indent:true },
  { type:'data', label:'No. Given Extraction',                                       field:'extraction',     indent:true },
  { type:'sub',  label:'Head count',                                                 field:'ext_head'        },
  { type:'sub',  label:'Tooth count',                                                field:'ext_tooth'       },
  { type:'data', label:'No. Given Sealant',                                          field:'sealant',        indent:true },
  { type:'sub',  label:'Head count',                                                 field:'sealant_head'    },
  { type:'sub',  label:'Tooth count',                                                field:'sealant_tooth'   },
  { type:'data', label:'No. Given Flouride Therapy',                                 field:'fluoride',       indent:true },
  { type:'sub',  label:'1st Dose',                                                   field:'fluor1'          },
  { type:'sub',  label:'2nd Dose',                                                   field:'fluor2'          },
  { type:'sub',  label:'No. Given Post Operative Treatment',                         field:'post_op'         },
  { type:'sub',  label:'No. of Patient with Oral Abscess Drained',                  field:'abscess'         },
  { type:'data', label:'No. Given Other Services',                                   field:'other',          indent:true },
  { type:'sub',  label:'No. Referred',                                               field:'referred'        },
  { type:'data', label:'No Given Counselling/ Education on Tobacco, Oral Health, Diet, Etc.', field:'counseling', indent:true },
  { type:'sub',  label:'No of Under 6 Children Completed Toothbrush Drill',         field:'toothbrush_drill'},

  { type:'header', label:'No. of Orally Fit Children (OFC)' },
  { type:'data', label:'OFC Upon Oral Examination',             field:'ofc_exam',   indent:true },
  { type:'data', label:'OFC Upon Complete Oral Rehabilitation', field:'ofc_rehab',  indent:true },
];

// Sprint 127: REFERRAL now exists, so `referralRows` is computed from the
// database below and this note applies to `sessionRows` alone — no bulk-Session
// model exists anywhere in the ERD, so that list stays permanently empty rather
// than carrying fabricated placeholder rows.
//
// ⚠ Sprint 105: they used to be called `referralRows`/`sessionRows` and their
// panels reported "0 referrals issued" / "No referrals recorded yet", which
// reads as A WORKING FEATURE WITH NO DATA rather than a feature that does not
// exist. That is the failure CLAUDE.md calls worse than a missing feature: the
// output looks authoritative. The tables are KEPT because their column sets
// document what such a model would have to hold, and because the DOH Oral
// Health Program Report already asks for referral counts (four rows, all
// printing "—" for the same missing model). The captions now say so plainly.
const NOT_TRACKED = 'Not tracked yet — no model exists';
type ReferralRow = { student:string; school:string; grade:string; date:string; sortKey:string; facility:string; reason:string; followUp:string; status:string };

// The same labels the student record's Referrals tab uses. Kept in words the
// DOH form uses, because this table is read next to that form.
const REFERRAL_TYPE_LABELS: Record<ReferralType, string> = {
  primary_care: 'Other Primary Care Facility',
  higher_level: 'Higher Level of Care',
  oral_cancer_screening: 'Oral Cancer Screening',
  surgical: 'Surgical Procedure',
  private_facility: 'Private Facility',
};
const sessionRows: { date:string; school:string; grade:string; section:string; students:number; procedures:string[]; treated:number }[] = [];


const GRADE_BAND_TILES: TileOption<'elem' | 'hs'>[] = [
  { v: 'elem', label: 'Kinder–Grade 6', hint: 'Elementary', icon: GraduationCap },
  { v: 'hs', label: 'Grade 7–10', hint: 'High school', icon: GraduationCap },
];
const SECTION_TILES: TileOption<'treatment' | 'conditions' | 'admin'>[] = [
  { v: 'treatment', label: 'Treatment Summary', hint: 'Procedures done', icon: Stethoscope },
  { v: 'conditions', label: 'Condition Summary', hint: 'Oral conditions found', icon: Activity },
  { v: 'admin', label: 'Overview', hint: 'Risk, consent, referrals', icon: LayoutDashboard },
];
type PeriodKind = 'range' | 'monthly' | 'quarterly' | 'biannual' | 'annual';
const ALL_GRADES_INT = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
const CONDITIONS  = ['Caries (Primary)','Caries (Permanent)','Gingivitis','Malocclusion','Orally Fit'];
type GX = Record<string,{M:number,F:number}>;

// No real per-condition breakdown by grade+gender exists --
// OralHealthCondition's fields don't cleanly map to these exact categories.
// Genuinely empty until that aggregation is built for real, never fabricated
// counts. (The treatment matrix IS real now — computed in the component from
// tooth-level treatment records.)
const conditionMatrix: Record<string,GX> = {};

const getCount = (matrix: Record<string,GX>, key: string, grade: string, gender: string): number => {
  const row = matrix[key];
  if (!row) return 0;
  if (grade !== 'all') {
    const g = row[grade];
    if (!g) return 0;
    if (gender === 'M') return g.M;
    if (gender === 'F') return g.F;
    return g.M + g.F;
  }
  return ALL_GRADES_INT.reduce((sum, gr) => {
    const g = row[gr];
    if (!g) return sum;
    if (gender === 'M') return sum + g.M;
    if (gender === 'F') return sum + g.F;
    return sum + g.M + g.F;
  }, 0);
};

// The school shown in the header band: a round badge with the school's initials. A fixed label when there is
// nothing to choose (one school, or a non-admin whose school follows the app), a dropdown otherwise. "All schools" appears first only when `allowAll`.
function SchoolBadge({ schools, value, allowAll, fixed = false, onChange }: {
  schools: string[]; value: string | null; allowAll: boolean; fixed?: boolean; onChange: (school: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const options: (string | null)[] = [...(allowAll ? [null] : []), ...schools];
  // `fixed`: the school follows the app's current school, so there is nothing to choose.
  const choosable = !fixed && options.length > 1;
  const initials = value ? getSchoolAcronym(value) : 'ALL';
  const name = value ?? 'All schools';
  const body = (
    <>
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-white text-[10px] font-extrabold text-primary">{initials.slice(0, 4)}</span>
      <span className="grid min-w-0 text-left leading-tight">
        <small className="text-[11px] text-white/75">{choosable ? 'Showing' : 'Reporting for'}</small>
        <b className="truncate text-[13px]">{name}{choosable ? ' ▾' : ''}</b>
      </span>
    </>
  );
  if (!choosable) return <div className="flex max-w-full items-center gap-2.5 rounded-full bg-white/15 py-1 pl-1 pr-4">{body}</div>;
  return (
    <div className="relative max-w-full">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Choose the school"
        className="flex max-w-full items-center gap-2.5 rounded-full bg-white/15 py-1 pl-1 pr-4 hover:bg-white/20">{body}</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 grid min-w-[16rem] max-w-[90vw] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-lg" role="listbox">
            {options.map((o) => (
              <button key={o ?? 'all'} type="button" role="option" aria-selected={o === value}
                onClick={() => { onChange(o); setOpen(false); }}
                className={`rounded-lg px-3 py-2 text-left text-sm ${o === value ? 'bg-primary-surface font-bold text-primary' : 'hover:bg-muted'}`}>
                {o ?? 'All schools'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const Reports = () => {
  const { selectedSchool, user } = useAuth();
  // Reports are PER SCHOOL (user, 2026-10-06). "All Schools" is offered only to a
  // System Admin and to Barangay Health Office staff, whose job is the consolidated
  // view; everyone else starts on, and can only switch between, their own school(s).
  const canSeeAllSchools = user?.role === 'system_admin' || user?.role === 'bho_staff';
  const ownSchool = (): string | null => (
    user && user.schools.length
      ? (selectedSchool && user.schools.includes(selectedSchool) ? selectedSchool : user.schools[0])
      : selectedSchool ?? null
  );
  // The DOH report covers a school year — this year's report is not next
  // year's (Sprint 57b). It used to count every record ever created, so it
  // could not answer "what did we do this year?" at all.
  // Declared here, above the hook call that consumes it — it used to sit
  // further down, which is fine until something above needs it.
  // ⚠ A user pinned to ONE school starts on that school, not on "All
  //   Schools". A school_admin holds exactly one, and the server scopes their
  //   data to it — so the old `null` default printed the caption
  //   "SCHOOL: All Schools" above figures that were only ever their own school's.
  //   A wrong school name on a DOH return is a different document.
  const [reportSchool, setReportSchool] = useState<string|null>(
    () => (canSeeAllSchools ? null : ownSchool()),
  );
  // School list comes from the DB now, not a hardcoded array (Sprint 60).
  const { schoolNames: allSchoolNames } = useSchools();
  // ⚠ ...but only the ones this user actually holds. Offering the other two
  //   to a school_admin was a control that did nothing: the server scopes every
  //   query by assignment, so picking another school changed the caption and
  //   left the numbers alone.
  const schoolNames = useMemo(
    () => (user && user.schools.length ? allSchoolNames.filter((n) => user.schools.includes(n)) : allSchoolNames),
    [allSchoolNames, user],
  );
  const isPinnedToOneSchool = !!user && user.schools.length === 1;
  // A user with no school assignment (an empty list means every school) who is not allowed the
  // consolidated view still needs ONE school selected: take the first, once the list has loaded.
  useEffect(() => {
    if (!canSeeAllSchools && !reportSchool && schoolNames.length) setReportSchool(ownSchool() ?? schoolNames[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeAllSchools, reportSchool, schoolNames]);
  const [dohSchoolYear, setDohSchoolYear] = useState<string | null>(() => schoolYearLabel());
  // The DOH tab's scope is a date period (Time period + Dates boxes), applied
  // server-side to each record's first recorded visit. It replaces the school
  // year here; the other report tabs still read `dohSchoolYear`.
  const [dohPeriod, setDohPeriod] = useState<PeriodDatesValue>(() => {
    const n = new Date();
    return { kind: 'month', start: toLocalDateString(new Date(n.getFullYear(), n.getMonth(), 1)), end: toLocalDateString(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
  });
  const { getRealCount, getRealTotal, years: dohYears, unplacedCount, loading: dohLoading } = useDohReportData(null, reportSchool, dohPeriod.start, dohPeriod.end);
  const dohPeriodLabel = (() => {
    const a = new Date(`${dohPeriod.start}T00:00:00`), b = new Date(`${dohPeriod.end}T00:00:00`);
    if (dohPeriod.kind === 'range') return `${formatDate(dohPeriod.start)} to ${formatDate(dohPeriod.end)}`;
    return a.getMonth() === b.getMonth() ? `${MONTHS[a.getMonth()]} ${a.getFullYear()}` : `${MONTHS[a.getMonth()]} to ${MONTHS[b.getMonth()]} ${a.getFullYear()}`;
  })();
  const dohPeriodSlug = `${dohPeriod.start}_to_${dohPeriod.end}`;

  // Sprint 128 — the calendar's school year is not necessarily a year the
  // database HAS. Opening Reports in September 2026 defaulted every DOH report
  // to 2026-2027 while every record sat under 2025-2026, so all three tabs
  // reported zeros and dashes on a database with 26 fully-charted students.
  //
  // Once the real year list arrives, a selection that names a year with no
  // records is replaced by the NEWEST year that has them. Only that case is
  // touched: `null` is the deliberate "All years to date" choice, and a year
  // that IS in the list is the user's own pick — neither is overridden, and
  // the align runs once rather than fighting the dropdown on every load.
  const didAlignYear = useRef(false);
  useEffect(() => {
    if (didAlignYear.current || dohYears.length === 0) return;
    if (dohSchoolYear !== null && !dohYears.includes(dohSchoolYear)) {
      setDohSchoolYear(dohYears[0]); // years arrive newest-first
    }
    didAlignYear.current = true;
  }, [dohYears, dohSchoolYear]);
  // Fields with no real backing data source yet show 0, never a fabricated
  // fallback number -- see useDohReportData.ts for exactly which fields are
  // real vs. not yet wireable.
  const V = (grade: string, age: string, sex: 'M'|'F', field: string): number =>
    getRealCount(grade, age, sex, field) ?? 0;
  // Hidden rows and grade columns on the Consolidated report, remembered per
  // browser (Sprint 73). Same rule as the other two report tabs: hiding
  // changes the OUTPUT, not just the view.
  //
  // ⚠ A hidden column here leaves in a FILE that can be forwarded without the
  // screen it came from. (This tab was once the only one that could export;
  // Sprints 85 and 88 gave the Program Report, Target Client List, IPTR and
  // School Summary their own controls, so the same care applies there.) The PDF inherits hiding for free (html2canvas captures the DOM), but
  // the Excel path is fed `rows` and `grades` explicitly and must be handed the
  // FILTERED lists — otherwise the spreadsheet would silently disagree with
  // both the screen and the PDF.
  const [hiddenDohRows, setHiddenDohRows] = useState<Set<string>>(() => {
    try { const r = window.localStorage.getItem('doh-hidden-rows'); return new Set(r ? JSON.parse(r) as string[] : []); }
    catch { return new Set(); }
  });
  const [hiddenGrades, setHiddenGrades] = useState<Set<string>>(() => {
    try { const r = window.localStorage.getItem('doh-hidden-grades'); return new Set(r ? JSON.parse(r) as string[] : []); }
    catch { return new Set(); }
  });
  const [showDohPicker, setShowDohPicker] = useState(false);
  const persistSet = (key: string, next: Set<string>) => {
    try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const toggleIn = (setter: (f: (p: Set<string>) => Set<string>) => void, key: string, storeKey: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistSet(storeKey, next);
      return next;
    });

  const [gradeBand, setGradeBand] = useState<GradeBand>('elem');
  const dohGrades = gradeBand === 'hs' ? HS_GRADES : ELEM_GRADES;
  const visibleGrades = dohGrades.filter((g) => !hiddenGrades.has(g));
  // Section headers follow their content: a header whose data rows are all
  // hidden would sit over nothing.
  const visibleDohRows = DOH_ROWS.filter((r) => r.type === 'header' || !hiddenDohRows.has(r.label));
  const dohHiddenCount = hiddenDohRows.size + hiddenGrades.size;
  // Printed/exported copies must say which band they cover — two PDFs for the
  // same school and month are otherwise indistinguishable once submitted.
  const bandLabel = gradeBand === 'hs' ? 'Grade 7-10' : 'Kinder-Grade 6';
  const bandSlug = gradeBand === 'hs' ? 'G7-10' : 'K-G6';
  const sumSummaryBracket = (field: string, sex: 'M'|'F', bracket: string) =>
    dohGrades.reduce((s, g) => {
      const ages = GRADE_BRACKETS[g].ages;
      if (ages.includes(bracket)) return s + V(g, bracket, sex, field);
      return s;
    }, 0);
  // Headline totals for the card above the table: every age bracket and both
  // sexes across the grades of the band in view.
  const bandTotal = (field: string) =>
    SUMMARY_BRACKETS.reduce((n, b) => n + sumSummaryBracket(field, 'M', b) + sumSummaryBracket(field, 'F', b), 0);
  // A field with no source in the system (getRealTotal returns null) prints a
  // dash, never a zero.
  const hasSource = (field: string) => getRealTotal('5-9 yrs', 'M', field) !== null;
  const [activeReportTab, setActiveReportTab] = useState<'doh'|'internal'|'tcl'|'ohprf'|'fhsis'|'summary'|'consent'>('doh');
  // ⚠ NAMED LINE LISTS ARE NOT FOR THE SCHOOL ADMINISTRATOR.
  //   The Target Client List and the Consent Form print one row per identified
  //   child — name, complete address, contact number, date of birth,
  //   PhilHealth number, and caries experience beside it. CLAUDE.md defines
  //   school_admin as "view school reports + dashboards only, NO CLINICAL
  //   RECORDS", and the manuscript is narrower still: the School Administrator
  //   is an external entity who "receives the School Dental Health Status and
  //   Service Report" (Ch. 3), an aggregate. The other four tabs are aggregates
  //   and stay. Found 2026-09-06 while auditing the role.
  const canSeeNamedClientLists = user?.role !== 'school_admin';
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportYear,  setReportYear]  = useState(new Date().getFullYear());
  // Local school override — defaults to All Schools regardless of global context
  const dohReportRef = useRef<HTMLDivElement>(null);
  // Heights of the DOH table's first two header rows, so rows 2 and 3 can pin directly under the one above
  // while the body scrolls (user, 2026-10-06). Measured, since the rows' heights depend on wrapping.
  const dohRow1Ref = useRef<HTMLTableRowElement>(null);
  const dohRow2Ref = useRef<HTMLTableRowElement>(null);
  const [dohRowH, setDohRowH] = useState({ r1: 24, r2: 24 });
  // Step buttons, hidden scroll bars and grab-and-drag for the wide DOH table (the OCR grid's pattern, user 2026-10-06).
  const { edge: dohEdge, step: stepDoh } = useGridScroll(dohReportRef, '[data-doh="indicator"]', [activeReportTab]);
  useEffect(() => {
    const r1 = dohRow1Ref.current;
    const r2 = dohRow2Ref.current;
    if (!r1 || !r2) return;
    const measure = () => setDohRowH({ r1: r1.offsetHeight, r2: r2.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(r1);
    ro.observe(r2);
    return () => ro.disconnect();
  });
  const { preview, building, previewPdf, previewExcel, closePreview, confirmDownload } = usePreviewModal();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const { students: realStudents } = useStudents();

  // Only offer the 7-10 band where secondary students actually exist for the
  // school in view — two of the three schools stop at G6, and a tab that is
  // permanently empty reads as a broken report rather than an empty one.
  const hasSecondary = useMemo(
    () => realStudents.some((s) => HS_GRADES.includes(s.grade) && (!reportSchool || s.school === reportSchool)),
    [realStudents, reportSchool],
  );
  // Switching to an elementary-only school while viewing 7-10 would otherwise
  // strand the user on an empty table with no visible way back.
  useEffect(() => {
    if (!hasSecondary && gradeBand === 'hs') setGradeBand('elem');
  }, [hasSecondary, gradeBand]);

  // Raw collections for the Treatment Summary's real per-procedure counts:
  // tooth records carry the procedure codes, their chart carries the date,
  // the IPTR links back to the student (school / grade / gender).
  // ⚠ Sprint 143 replaced FIVE whole-collection reads (treatments, tooth
  // records, dental charts, IPTRs, referrals) with one `/stats/reports-panels`
  // request. The joins live in `shared/reportsPanels.ts` — see #24.
  const [panels, setPanels] = useState<ReportsPanelsOutput>({
    treatmentMatrix: {},
    periodTreatmentCount: 0,
    allTimeTreatmentCount: 0,
    referralRows: [],
  });

  const handleDownloadPdf = () => {
    if (!dohReportRef.current) return;
    setDownloadError(null);
    const el = dohReportRef.current;
    const schoolPart = reportSchool ? getSchoolShortName(reportSchool).replace(/\s+/g, '_') : 'AllSchools';
    const filename = `DOH_Report_${schoolPart}_${bandSlug}_${dohPeriodSlug}.pdf`;
    previewPdf('DOH Consolidated Report', filename, async () => {
      try {
        return await buildDohReportPdf(el);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Failed to generate PDF');
        return null;
      }
    });
  };

  const handleDownloadExcel = () => {
    setDownloadError(null);
    const schoolPart = reportSchool ? getSchoolShortName(reportSchool).replace(/\s+/g, '_') : 'AllSchools';
    const filename = `DOH_Consolidated_${schoolPart}_${bandSlug}_${dohPeriodSlug}.xlsx`;
    previewExcel('DOH Consolidated Report', filename, async () => {
      try {
        return await buildDohReportXlsx({
          grades: visibleGrades,
          gradeBrackets: GRADE_BRACKETS,
          summaryBrackets: SUMMARY_BRACKETS,
          rows: visibleDohRows,
          getCell: (g, a, s, f) => V(g, a, s, f),
          school: reportSchool ? getSchoolShortName(reportSchool) : 'All Schools',
          // The spreadsheet has to say it is shortened: unlike the printout,
          // a file gets forwarded without the screen it came from.
          monthYear: `${dohPeriodLabel} · ${bandLabel}${dohHiddenCount ? ` · SHORTENED — ${hiddenDohRows.size} row(s), ${hiddenGrades.size} grade(s) hidden` : ''}`,
        });
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Failed to generate Excel');
        return null;
      }
    });
  };
  const [internalSection, setInternalSection] = useState<'treatment'|'conditions'|'admin'>('treatment');
  const [periodType, setPeriodType] = useState<PeriodKind>('monthly');
  // Custom range (periodType 'range'): inclusive first and last day, local "YYYY-MM-DD".
  const [rangeStart, setRangeStart] = useState(() => { const d = new Date(); return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [rangeEnd, setRangeEnd] = useState(() => toLocalDateString(new Date()));
  // Same rule as the DOH tab above: pinned to their own school when they hold one.
  const [intSchoolFilter, setIntSchoolFilter] = useState(() => (canSeeAllSchools ? 'all' : ownSchool() ?? 'all'));
  useEffect(() => {
    if (!canSeeAllSchools && intSchoolFilter === 'all' && schoolNames.length) setIntSchoolFilter(ownSchool() ?? schoolNames[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeAllSchools, intSchoolFilter, schoolNames]);
  // The header badge picks the school for EVERY report at once (one source of truth).
  const activeSchool = reportSchool;
  const chooseSchool = (name: string | null) => { setReportSchool(name); setIntSchoolFilter(name ?? 'all'); };
  // Only the System Admin picks a school here (user, 2026-10-06). Everyone else's reports follow the school
  // they are viewing in the app, automatically: the same school as the rest of the screens, no dropdown.
  const canPickSchool = user?.role === 'system_admin';
  useEffect(() => {
    if (canPickSchool) return;
    const auto = canSeeAllSchools ? selectedSchool : ownSchool();
    setReportSchool(auto);
    setIntSchoolFilter(auto ?? 'all');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPickSchool, canSeeAllSchools, selectedSchool, user, schoolNames]);
  const [intGradeFilter, setIntGradeFilter] = useState('all');
  const [intGenderFilter, setIntGenderFilter] = useState('all');
  const [intAgeFilter, setIntAgeFilter] = useState('all');

  // Reporting period anchored to the header's month/year selectors: the
  // quarter / half-year / year containing the selected month (per the
  // dentist's cadence: monthly → quarterly → semiannual → annual, where an
  // aggregate is just the sum of its months).
  const periodRange = useMemo(() => {
    const y = reportYear;
    const m = reportMonth - 1;
    if (periodType === 'range') {
      const [sy, sm, sd] = rangeStart.split('-').map(Number);
      const [ey, em, ed] = rangeEnd.split('-').map(Number);
      // End is exclusive, so a range of one day is [that day, the next day).
      return { start: new Date(sy, sm - 1, sd), end: new Date(ey, em - 1, ed + 1) };
    }
    if (periodType === 'monthly')   return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    if (periodType === 'quarterly') { const q = Math.floor(m / 3) * 3; return { start: new Date(y, q, 1), end: new Date(y, q + 3, 1) }; }
    if (periodType === 'biannual')  { const h = m < 6 ? 0 : 6; return { start: new Date(y, h, 1), end: new Date(y, h + 6, 1) }; }
    return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }, [periodType, reportMonth, reportYear, rangeStart, rangeEnd]);

  // The period and school are applied SERVER-side; filtering afterwards would
  // put the whole population back on the wire, which is the thing #24 is about.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          from: periodRange.start.toISOString(),
          to: periodRange.end.toISOString(),
        });
        if (intSchoolFilter !== 'all') params.set('school', intSchoolFilter);
        const data = await apiClient.get<ReportsPanelsOutput>(`/stats/reports-panels?${params.toString()}`);
        if (!cancelled) setPanels(data);
      } catch (err) {
        console.error('Reports panels fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [periodRange, intSchoolFilter]);

  const referralRows = panels.referralRows;

  const periodLabel = periodType === 'range'
    ? (rangeStart === rangeEnd ? formatDate(rangeStart) : `${formatDate(rangeStart)} to ${formatDate(rangeEnd)}`)
    : periodType === 'monthly'
    ? `${MONTHS[reportMonth - 1]} ${reportYear}`
    : `${periodRange.start.toLocaleDateString('en-US', { month: 'short' })}–${new Date(periodRange.end.getFullYear(), periodRange.end.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'short' })} ${reportYear}`;

  // Real per-procedure counts from tooth-level treatment records. Tooth
  // records carry no date of their own, so each is dated by its chart's
  // date_charted (the closest real date the ERD provides — noted in the UI).
  // ⚠ ROWS ARE CODES NOW, rendered with their label. The server keys the
  // matrix by treatment CODE (Sprint 143) because labels carry the clinic's
  // local terms and belong to the UI — keeping the rows on labels here would
  // have looked up `matrix['Extraction']` against a map keyed `X` and printed
  // a table of zeros, with a clean typecheck (Record<string, …> accepts any
  // key). Caught by reading, not by tsc.
  const TREATMENT_ROWS = useMemo(() => treatmentCodes.map((t) => t.code), []);
  const labelForCode = useMemo(
    () => new Map(treatmentCodes.map((t) => [t.code, t.label])),
    [],
  );
  // ⚠ KEYED BY TREATMENT CODE now, not by label: labels carry the clinic's
  // local terms ("Bunot", "Pasta") and belong to the UI, so the server never
  // sends them. The rows below map code -> label at render time.
  const realTreatmentMatrix = panels.treatmentMatrix;
  const periodTreatmentCount = panels.periodTreatmentCount;
  const realTreatmentCount = panels.allTimeTreatmentCount; // all-time, for the admin Overview tab
  const [expandedReferral, setExpandedReferral] = useState<number|null>(null);

  const AGE_TO_GRADES: Record<string,string[]> = {
    '4 & below': ['Kinder'],
    '5-9': ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4'],
    '10-14': ['Grade 5','Grade 6','Grade 7','Grade 8','Grade 9'],
    '15-19': ['Grade 10'],
    '20 & above': [],
  };
  const activeGrades = intAgeFilter !== 'all'
    ? AGE_TO_GRADES[intAgeFilter]
    : intGradeFilter !== 'all'
    ? [intGradeFilter]
    : null;
  const cnt = (matrix: Record<string,GX>, key: string, gender: string): number =>
    activeGrades
      ? activeGrades.reduce((s, g) => s + getCount(matrix, key, g, gender), 0)
      : getCount(matrix, key, 'all', gender);
  const displayGrades = intAgeFilter !== 'all' ? AGE_TO_GRADES[intAgeFilter] : ALL_GRADES_INT;
  const clearStudentFilters = () => { setIntGradeFilter('all'); setIntGenderFilter('all'); setIntAgeFilter('all'); };
  const activeStudentFilters = [intAgeFilter, intGradeFilter, intGenderFilter].filter((v) => v !== 'all').length;
  const clearIntFilters = () => { setIntSchoolFilter('all'); setIntGradeFilter('all'); setIntGenderFilter('all'); setIntAgeFilter('all'); };
  const hasIntFilters = intSchoolFilter !== 'all' || intGradeFilter !== 'all' || intGenderFilter !== 'all' || intAgeFilter !== 'all';

  // ── Internal Reports: Print / PDF / Excel (user-approved menu, 2026-10-08) ──
  // Print = the browser's print window. PDF = a snapshot of the open section,
  // shown in the preview first. Excel = the same figures as a workbook,
  // downloaded straight away. Both files say which period and filters they
  // were made with, since a file is forwarded without the screen it came from.
  const internalRef = useRef<HTMLDivElement>(null);
  const [internalXlsxBusy, setInternalXlsxBusy] = useState(false);
  const internalName = internalSection === 'treatment' ? 'Treatment Summary' : internalSection === 'conditions' ? 'Condition Summary' : 'Overview';
  const internalFilterNote = [
    intAgeFilter !== 'all' ? `Age ${intAgeFilter}` : '',
    intGradeFilter !== 'all' ? intGradeFilter : '',
    intGenderFilter !== 'all' ? (intGenderFilter === 'M' ? 'Male' : 'Female') : '',
  ].filter(Boolean).join(', ');
  const internalBaseName = () => [
    'Internal', internalName.replace(/\s+/g, '-'),
    reportSchool ? getSchoolShortName(reportSchool).replace(/\s+/g, '_') : 'AllSchools',
    internalSection === 'conditions' ? 'all-time' : periodLabel.replace(/[^\w]+/g, '-'),
  ].join('_');

  const handleInternalPdf = () => {
    const el = internalRef.current;
    if (!el) return;
    setDownloadError(null);
    previewPdf(`${internalName} (${internalSection === 'conditions' ? 'all time' : periodLabel})`, `${internalBaseName()}.pdf`, async () => {
      try {
        return await buildDohReportPdf(el);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Failed to generate PDF');
        return null;
      }
    });
  };

  const handleInternalExcel = async () => {
    setDownloadError(null);
    setInternalXlsxBusy(true);
    try {
      const scope = `${internalSection === 'conditions' ? 'All time' : periodLabel}${internalFilterNote ? ` · ${internalFilterNote}` : ''}`;
      let blob: Blob;
      if (internalSection === 'treatment') {
        type TRow = { label: string; m: number; f: number; t: number };
        const rows: TRow[] = TREATMENT_ROWS.map((p) => ({ label: labelForCode.get(p) ?? p, m: cnt(realTreatmentMatrix, p, 'M'), f: cnt(realTreatmentMatrix, p, 'F'), t: cnt(realTreatmentMatrix, p, 'M') + cnt(realTreatmentMatrix, p, 'F') }));
        rows.push({ label: 'Total', m: rows.reduce((a, r) => a + r.m, 0), f: rows.reduce((a, r) => a + r.f, 0), t: rows.reduce((a, r) => a + r.t, 0) });
        blob = await buildXlsx(rows, [
          { label: `Procedure · ${scope}`, value: (r: TRow) => r.label },
          { label: 'Male', value: (r: TRow) => r.m },
          { label: 'Female', value: (r: TRow) => r.f },
          { label: 'Total', value: (r: TRow) => r.t },
        ], 'Treatment Summary');
      } else if (internalSection === 'conditions') {
        type CRow = { cond: string };
        blob = await buildXlsx(CONDITIONS.map((cond): CRow => ({ cond })), [
          { label: `Condition · ${scope}`, value: (r: CRow) => r.cond },
          ...displayGrades.map((g) => ({ label: g, value: (r: CRow) => getCount(conditionMatrix, r.cond, g, intGenderFilter) })),
          { label: 'Total', value: (r: CRow) => cnt(conditionMatrix, r.cond, intGenderFilter) },
        ], 'Condition Summary');
      } else {
        const consent = schoolNames.map((school) => {
          const inSchool = realStudents.filter((st) => st.school === school);
          return { school, complete: inSchool.filter((st) => st.consentStatus === 'complete').length, total: inSchool.length };
        });
        const sheets = [
          { name: 'Quick stats', rows: [
              { k: 'High risk students', v: realStudents.filter((st) => st.riskLevel === 'High').length },
              { k: 'Medium risk students', v: realStudents.filter((st) => st.riskLevel === 'Medium').length },
              { k: 'Students treated (all time)', v: realTreatmentCount },
            ], columns: [{ label: 'Measure', value: (r: { k: string; v: number }) => r.k }, { label: 'Count', value: (r: { k: string; v: number }) => r.v }] },
          { name: 'Consent by school', rows: consent, columns: [
              { label: 'School', value: (r: typeof consent[number]) => r.school },
              { label: 'Complete', value: (r: typeof consent[number]) => r.complete },
              { label: 'Total', value: (r: typeof consent[number]) => r.total },
              { label: 'Percent', value: (r: typeof consent[number]) => (r.total ? `${Math.round((r.complete / r.total) * 100)}%` : '') },
            ] },
        ];
        // Referrals are a clinical record: never in a file for the school administrator (see the on-screen table).
        const refCols = user?.role !== 'school_admin' ? [{ name: `Referrals · ${periodLabel}`, rows: referralRows, columns: [
          { label: 'Student', value: (r: typeof referralRows[number]) => r.student },
          { label: 'School', value: (r: typeof referralRows[number]) => r.school },
          { label: 'Grade', value: (r: typeof referralRows[number]) => r.grade },
          { label: 'Date issued', value: (r: typeof referralRows[number]) => r.date },
          { label: 'Facility', value: (r: typeof referralRows[number]) => r.facility },
          { label: 'Reason', value: (r: typeof referralRows[number]) => r.reason },
          { label: 'Follow-up', value: (r: typeof referralRows[number]) => r.followUp },
          { label: 'Status', value: (r: typeof referralRows[number]) => r.status },
        ] }] : [];
        blob = await buildSheetsXlsx<any>([...sheets, ...refCols]);
      }
      downloadBlob(blob, `${internalBaseName()}.xlsx`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to generate Excel');
    } finally {
      setInternalXlsxBusy(false);
    }
  };

// Build column definitions: for each grade, each age bracket, M and F
  const cols: { grade:string; age:string; sex:'M'|'F' }[] = [];
  visibleGrades.forEach(g => {
    GRADE_BRACKETS[g].ages.forEach(a => {
      cols.push({ grade:g, age:a, sex:'M' });
      cols.push({ grade:g, age:a, sex:'F' });
    });
  });

  // Summary cols: per age bracket, M and F
  const sumCols: { bracket:string; sex:'M'|'F' }[] = [];
  SUMMARY_BRACKETS.forEach(b => {
    sumCols.push({ bracket:b, sex:'M' });
    sumCols.push({ bracket:b, sex:'F' });
  });

  const thBase = "text-center px-1 py-1 text-[9px] font-semibold border-r border-border";
  const tdBase = "text-center px-1 py-1 font-mono border-r border-gray-100 text-[10px]";

  // Two-tier report categories: a primary card per category, plus an
  // ordered pill row of that category's own reports underneath. Order and
  // grouping requested explicitly -- Internal Reports category first, its
  // reports led by School Summary; DOH Consolidated category ordered
  // Target Client List, DOH Consolidated, FHSIS, Program Report.
  const reportCategories = [
    {
      id: 'internal' as const,
      label: 'School Internal Reports',
      subtitle: 'Clinic-facing summaries',
      tabs: [
        { id: 'internal' as const, label: 'Internal Reports', icon: FileText, visible: true },
        { id: 'summary' as const, label: 'School Summary', icon: FileSpreadsheet, visible: true },
        { id: 'consent' as const, label: 'Consent Form', icon: FileText, visible: canSeeNamedClientLists },
      ],
    },
    {
      id: 'doh' as const,
      label: 'DOH Consolidated Reports',
      subtitle: 'City Health Office report',
      tabs: [
        { id: 'tcl' as const, label: 'Target Client List', icon: Users, visible: canSeeNamedClientLists },
        { id: 'doh' as const, label: 'DOH Consolidated', icon: FileSpreadsheet, visible: true },
        { id: 'fhsis' as const, label: 'FHSIS', icon: FileSpreadsheet, visible: true },
        { id: 'ohprf' as const, label: 'Program Report', icon: FileSpreadsheet, visible: true },
      ],
    },
  ];
  const activeCategory = reportCategories.find(cat => cat.tabs.some(t => t.id === activeReportTab)) ?? reportCategories[0];

  if (dohLoading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  // School year picker, shared by the DOH tab, Program Report and School
  // Summary (they all read dohSchoolYear). School year, not calendar month:
  // the figures are per-IPTR, and an IPTR belongs to a school year.
  const yearSelect = (
    <Underlined icon={Calendar} chevron>
      <select id="doh-school-year" aria-label="School year" value={dohSchoolYear ?? ''} onChange={e => setDohSchoolYear(e.target.value || null)}
        className={`${fieldInputClass} !pr-5`}>
        {/* "All years to date" stays: it is still the right answer for a cumulative count. */}
        <option value="">All years to date</option>
        {/* ⚠ The selected year is listed even when the database holds no
            records for it, so the control always shows the year it is really
            using — otherwise the <select> falls back to its FIRST option and
            reads "All years to date" while the report filters to an empty year. */}
        {dohSchoolYear && !dohYears.includes(dohSchoolYear) && (
          <option value={dohSchoolYear}>{dohSchoolYear} (no records)</option>
        )}
        {dohYears.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </Underlined>
  );

  return (
    <div className="min-w-0 space-y-4">
      {/* Header band (user pick, 2026-10-06): the title and the school on top, the seven reports as tabs in two
          labelled groups (clinic, City Health Office), the open tab white. One school at a time: the badge is a
          fixed label for a person with one school, a dropdown for several, and "All schools" is offered only when
          canSeeAllSchools. The band replaces the two category cards, the "Other reports" row and the page header. */}
      <div className="min-w-0">
        <div className="rounded-t-2xl bg-primary px-4 pt-4 text-white sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
                <FileBarChart className="h-7 w-7 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/75">Reporting</div>
                <h1 className="text-[22px] font-extrabold leading-tight">Reports</h1>
                <p className="text-xs text-white/75">DOH Consolidated Report and internal reports for every school year on file.</p>
              </div>
            </div>
            <SchoolBadge
              schools={schoolNames}
              value={activeSchool}
              allowAll={canSeeAllSchools}
              fixed={!canPickSchool}
              onChange={chooseSchool}
            />
          </div>
          {/* Two groups (user pick, 2026-10-06): each has its name above it with a thin rule over the group's width,
              and the open tab is white with curved inside corners so it flows into the controls card below. */}
          <div className="mt-8 flex items-end gap-7 overflow-x-auto no-scrollbar">
            {([
              { label: 'For the clinic', tabs: reportCategories[0].tabs },
              { label: 'For the City Health Office', tabs: reportCategories[1].tabs },
            ]).map((g) => (
              <div key={g.label} className="flex-shrink-0">
                <div className="mb-1 border-b border-white/25 pb-1 text-[9.5px] font-bold uppercase tracking-[0.09em] text-white/85">{g.label}</div>
                <div className="flex items-end" role="tablist" aria-label={g.label}>
                  {g.tabs.filter((t) => t.visible).map((tab) => {
                    const on = activeReportTab === tab.id;
                    return (
                      <button key={tab.id} type="button" role="tab" aria-selected={on} onClick={() => setActiveReportTab(tab.id)}
                        className={`relative whitespace-nowrap rounded-t-xl px-4 py-2.5 text-[12px] font-bold ${on ? 'bg-card text-foreground' : 'text-white hover:bg-white/10'}`}>
                        {tab.label}
                        {on && (
                          <>
                            <i aria-hidden="true" className="pointer-events-none absolute -left-3 bottom-0 h-3 w-3" style={{ background: 'radial-gradient(circle at 0 0, transparent 12px, var(--card) 12.5px)' }} />
                            <i aria-hidden="true" className="pointer-events-none absolute -right-3 bottom-0 h-3 w-3" style={{ background: 'radial-gradient(circle at 100% 0, transparent 12px, var(--card) 12.5px)' }} />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {downloadError && (
        <div className="text-sm text-destructive bg-red-50 border border-red-200 rounded-lg px-4 py-2">{downloadError}</div>
      )}

      {/* ── DOH CONSOLIDATED ── */}
      {activeReportTab === 'doh' && (
        <div className="space-y-8">
          <PanelShell>
            <PanelRow>
              <PeriodDatesBoxes initialKind="month" onChange={setDohPeriod} />
              {hasSecondary && (
                <GroupBox title="Grades" className={BOX_W}>
                  <PeriodTiles<GradeBand> full icons name="Grade band" value={gradeBand} onChange={setGradeBand} options={GRADE_BAND_TILES} />
                </GroupBox>
              )}
              <div className="flex self-start lg:ml-auto">
                {/* Print / PDF (preview first) / Excel — same menu as the other report tabs. */}
                <div className="flex">
                <FiltersButton count={dohHiddenCount}>
                  <p className="text-[12px] text-muted-foreground">
                    {dohHiddenCount ? `${hiddenDohRows.size} row(s) and ${hiddenGrades.size} grade(s) hidden. Hiding also changes the PDF and Excel.` : 'All rows and grades are shown.'}
                  </p>
                  <button type="button" onClick={() => setShowDohPicker((v) => !v)}
                    className="flex h-9 items-center gap-2 rounded-[10px] border border-[#e3e7ef] bg-[#f1f3f8] px-3 text-[12.5px] font-bold text-[#46536d] hover:bg-[#e9ecf3]">
                    <SlidersHorizontal className="h-4 w-4 text-[#7a859b]" aria-hidden="true" />
                    {showDohPicker ? 'Close rows and grades' : 'Choose rows and grades'}
                  </button>
                  {dohHiddenCount > 0 && (
                    <button type="button" className="h-9 rounded-[10px] text-[12.5px] font-bold text-primary hover:underline"
                      onClick={() => {
                        setHiddenDohRows(new Set()); persistSet('doh-hidden-rows', new Set());
                        setHiddenGrades(new Set()); persistSet('doh-hidden-grades', new Set());
                      }}>Show everything</button>
                  )}
                </FiltersButton>
                <ExportMenu joined busy={building} onPrint={() => window.print()} onPdf={handleDownloadPdf} onExcel={handleDownloadExcel}
                  excelDisabledReason={dohLoading ? 'Loading' : undefined} pdfDisabledReason={dohLoading ? 'Loading' : undefined} />
                </div>
              </div>
            </PanelRow>
            <p className="sr-only" aria-live="polite">Showing {dohPeriodLabel}, {reportSchool ? getSchoolShortName(reportSchool) : 'all schools'}</p>
          </PanelShell>

          {(() => {
            const attended = bandTotal('attended');
            const examined = bandTotal('examined');
            const caries = bandTotal('DMF_total') + bandTotal('dmf_df');
            const pct = examined > 0 ? caries / examined : 0;
            const r = 36, c = 2 * Math.PI * r;
            const tile = (label: string, value: string, hint?: string) => (
              <div className="min-w-[8.5rem] flex-1 rounded-xl bg-[#eef1f7] px-3.5 py-2.5">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
                <div className="text-[26px] font-extrabold leading-tight text-primary tabular-nums">{value}</div>
                {hint && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
              </div>
            );
            return (
              <div className="rounded-2xl border border-[#dfe5f0] bg-card px-5 py-4 shadow-[0_14px_30px_-22px_rgba(36,59,122,0.5)]">
                <h2 className="text-base font-extrabold text-foreground">Dental Section: Consolidated Oral Health Status and Service Report</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {dohPeriodLabel} · {reportSchool ? getSchoolShortName(reportSchool) : 'All schools'} · {bandLabel}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-4">
                  <div className="flex items-center gap-3.5">
                    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`With caries experience: ${Math.round(pct * 100)}%`}>
                      <circle cx="42" cy="42" r={r} fill="none" stroke="#eef1f7" strokeWidth="8" />
                      <circle cx="42" cy="42" r={r} fill="none" stroke="#243b7a" strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 42 42)" />
                      <text x="42" y="47" textAnchor="middle" fontSize="15" fontWeight="800" fill="#14213d">{Math.round(pct * 100)}%</text>
                    </svg>
                    <div>
                      <div className="text-[13px] font-extrabold text-foreground">With caries experience</div>
                      <div className="text-[11.5px] text-muted-foreground">{caries} of {examined} examined.</div>
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">DMF or dmf score above 0.</div>
                    </div>
                  </div>
                  <div className="flex min-w-[18rem] flex-1 flex-wrap gap-2.5">
                    {tile('Attended', String(attended), 'Students seen this period.')}
                    {tile('Orally examined', String(examined), 'Students with recorded mouth findings.')}
                    {tile('No. Given Fluoride Therapy', hasSource('fv_1st') ? String(bandTotal('fv_1st')) : '—', 'Given at least one varnish.')}
                    {tile('Orally Fit Child', hasSource('ofc_exam') ? String(bandTotal('ofc_exam')) : '—', 'Examined students with Low risk.')}
                  </div>
                </div>
              </div>
            );
          })()}

          {showDohPicker && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3 text-xs">
              <p className="text-muted-foreground">
                Untick to hide. Hiding changes the <span className="font-medium text-foreground">PDF and Excel</span> too,
                not just the screen — this is the one report that leaves as a file, so anything hidden is stamped
                on the sheet itself.
              </p>
              <div>
                <div className="font-semibold text-foreground mb-1.5">Grades</div>
                <div className="flex flex-wrap gap-3">
                  {dohGrades.map((g) => (
                    <label key={g} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!hiddenGrades.has(g)}
                        onChange={() => toggleIn(setHiddenGrades, g, 'doh-hidden-grades')}
                        className="w-3.5 h-3.5 rounded accent-primary" />
                      <span>{g}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-semibold text-foreground mb-1.5">Rows</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {DOH_ROWS.filter((r) => r.type !== 'header').map((r) => (
                    <label key={r.label} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={!hiddenDohRows.has(r.label)}
                        onChange={() => toggleIn(setHiddenDohRows, r.label, 'doh-hidden-rows')}
                        className="w-3.5 h-3.5 rounded accent-primary" />
                      <span className="truncate" title={r.label}>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {dohHiddenCount > 0 && (
                <button
                  onClick={() => {
                    setHiddenDohRows(new Set()); persistSet('doh-hidden-rows', new Set());
                    setHiddenGrades(new Set()); persistSet('doh-hidden-grades', new Set());
                  }}
                  className="px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50"
                >Show everything</button>
              )}
            </div>
          )}

          {/* Table */}
          <div id="doh-report-printable" className="form-print relative bg-card rounded-t-xl border border-[#A9BDE6] overflow-hidden -mb-4 md:-mb-8">
            {/* ref goes on the scrollable inner div, not the overflow-hidden outer
                one — html2canvas clips to the ref'd element's own rendered box,
                so ref'ing the outer div only captured the already-clipped width. */}
            <div ref={dohReportRef} className="no-scrollbar cursor-grab rounded-t-xl overflow-auto [container-type:inline-size] max-h-[max(320px,calc(100vh_-_94px))] print:max-h-none">
              {/* INSIDE the ref'd element deliberately. html2canvas captures
                  `dohReportRef.current` itself, so a banner placed as a sibling
                  above it would show on screen and be missing from the PDF —
                  precisely the case this warning exists to prevent. */}
              {dohHiddenCount > 0 && (
                <p className="px-3 py-2 text-[11px] font-semibold text-destructive border-b border-border">
                  SHORTENED FORM — not the complete DOH report: {hiddenDohRows.size} row(s) and{' '}
                  {hiddenGrades.size} grade(s) hidden.
                </p>
              )}
              <table style={{borderCollapse:'separate', borderSpacing:0, fontSize:'10px', whiteSpace:'nowrap', ['--doh-r2' as string]: `${dohRowH.r1}px`, ['--doh-r3' as string]: `${dohRowH.r1 + dohRowH.r2}px`}}>
                {/* ── TITLE ── */}
                <thead>
                  <tr>
                    <th colSpan={1 + cols.length*2 + sumCols.length*2 + 2}
                      className="text-center py-2 px-3 bg-[#CFDDF6] border-b border-border text-[11px] font-bold text-[#273A78] uppercase tracking-wide">
                      {/* Pinned to the visible width (100cqw = this scroller) so the title stays centred on screen
                          instead of in the middle of a table several screens wide; in the PDF capture the scroller
                          is the full table, so it centres over the whole table there. */}
                      <div className="sticky left-0" style={{ width: '100cqw' }}>
                        DENTAL SECTION: CONSOLIDATED ORAL HEALTH STATUS AND SERVICE REPORT
                      </div>
                    </th>
                  </tr>

                  {/* ── ROW 1: GRADE HEADERS ── */}
                  <tr ref={dohRow1Ref} className="bg-gray-50 border-b border-border [&>th]:sticky [&>th]:top-0 [&>th]:z-10">
                    {/* Phones (< sm): the frozen label column is a fixed 9rem and
                        wraps, so data columns show beside it (it used to take
                        321 of 346 px at 390 px wide, user-reported 2026-10-04).
                        sm and up are unchanged. The PDF export renders at the
                        table's full width, so it always gets the sm+ layout. */}
                    <th data-doh="indicator" rowSpan={3} className="sticky left-0 bg-gray-50 !z-20 text-left px-2 py-1 border-r border-border text-[10px] font-semibold text-muted-foreground min-w-[240px] max-sm:w-36 max-sm:min-w-36">
                      Indicator
                    </th>
                    {visibleGrades.map(g => {
                      const bracketCount = GRADE_BRACKETS[g].ages.length;
                      // Each bracket has 2 sex cols + 2 total cols
                      const colSpanCount = bracketCount * 2 + 2;
                      return (
                        <th key={g} data-doh="grade" colSpan={colSpanCount}
                          className={`${thBase} bg-blue-50 text-blue-800 border-r-2 border-blue-200`}>
                          {GRADE_BRACKETS[g].label}
                        </th>
                      );
                    })}
                    <th data-doh="summary" colSpan={sumCols.length}
                      className={`${thBase} bg-purple-50 text-purple-800`}>
                      SUMMARY
                    </th>
                  </tr>

                  {/* ── ROW 2: AGE BRACKET HEADERS ── */}
                  <tr ref={dohRow2Ref} className="bg-gray-50 border-b border-border [&>th]:sticky [&>th]:top-[var(--doh-r2)] [&>th]:z-10 [&>th]:bg-gray-50">
                    {visibleGrades.map(g =>
                      [...GRADE_BRACKETS[g].ages.map(a => (
                        <th key={g+a} colSpan={2}
                          className={`${thBase} text-muted-foreground text-[8px]`}>
                          {a}
                        </th>
                      )),
                      <th key={g+'total'} colSpan={2}
                        className={`${thBase} text-blue-700 font-bold border-r-2 border-blue-200`}>
                        Total
                      </th>]
                    )}
                    {SUMMARY_BRACKETS.map(b => (
                      <th key={'sum'+b} colSpan={2}
                        className={`${thBase} text-purple-700 text-[8px]`}>
                        {b}
                      </th>
                    ))}
                  </tr>

                  {/* ── ROW 3: M/F HEADERS ── */}
                  <tr className="bg-gray-50 border-b-2 border-border [&>th]:sticky [&>th]:top-[var(--doh-r3)] [&>th]:z-10 [&>th]:bg-gray-50">
                    {visibleGrades.map(g =>
                      [...GRADE_BRACKETS[g].ages.flatMap(a => [
                        <th key={g+a+'M'} className={`${thBase} text-blue-600 w-6`}>M</th>,
                        <th key={g+a+'F'} className={`${thBase} text-pink-700 w-6`}>F</th>,
                      ]),
                      <th key={g+'totM'} className={`${thBase} text-blue-700 font-bold w-6`}>M</th>,
                      <th key={g+'totF'} className={`${thBase} text-pink-700 font-bold border-r-2 border-blue-200 w-6`}>F</th>]
                    )}
                    {SUMMARY_BRACKETS.flatMap(b => [
                      <th key={'sum'+b+'M'} className={`${thBase} text-blue-600 w-6`}>M</th>,
                      <th key={'sum'+b+'F'} className={`${thBase} text-pink-700 w-6`}>F</th>,
                    ])}
                  </tr>
                </thead>

                {/* ── BODY ── */}
                <tbody>
                  {visibleDohRows.map((row, idx) => {
                    if (row.type === 'header') {
                      const restCols = cols.length*2 + dohGrades.length*2 + sumCols.length;
                      return (
                        <tr key={idx} className="bg-blue-50 border-t border-b border-blue-200">
                          <td className="sticky left-0 z-10 px-3 py-1 font-bold text-blue-900 text-[10px] uppercase tracking-wide bg-blue-50 min-w-[240px] max-sm:min-w-0">
                            <div className="max-sm:w-32 max-sm:whitespace-normal max-sm:break-words">{row.label}</div>
                          </td>
                          <td colSpan={restCols} className="bg-blue-50" />
                        </tr>
                      );
                    }

                    const isSub   = row.type === 'sub';
                    const field   = row.field;
                    const labelPadding = isSub ? 'pl-8 italic text-muted-foreground' : (row as any).indent ? 'pl-5 text-foreground' : 'font-medium text-foreground';

                    return (
                      <tr key={idx} className="group border-b border-gray-100 hover:bg-yellow-50 transition-colors">
                        {/* Label */}
                        <td className={`sticky left-0 bg-card group-hover:bg-yellow-50 border-r border-border px-2 py-0.5 text-[10px] transition-colors ${labelPadding} min-w-[240px] max-sm:min-w-0`}>
                          {/* the <table> sets white-space: nowrap; phones let the label wrap */}
                          <div className="max-sm:w-32 max-sm:whitespace-normal max-sm:break-words">{row.label}</div>
                        </td>

                        {/* Per grade per age bracket M/F + grade total M/F */}
                        {visibleGrades.map(g => {
                          const ages = GRADE_BRACKETS[g].ages;
                          const ageCells = ages.flatMap(a => {
                            const mv = V(g, a, 'M', field);
                            const fv = V(g, a, 'F', field);
                            return [
                              <td key={g+a+'M'} className={`${tdBase} text-foreground w-6`}>{cell(mv)}</td>,
                              <td key={g+a+'F'} className={`${tdBase} text-foreground w-6`}>{cell(fv)}</td>,
                            ];
                          });
                          const totM = ages.reduce((s,a) => s+V(g,a,'M',field),0);
                          const totF = ages.reduce((s,a) => s+V(g,a,'F',field),0);
                          return [
                            ...ageCells,
                            <td key={g+'totM'} className={`${tdBase} font-bold text-blue-700 w-6`}>{cell(totM)}</td>,
                            <td key={g+'totF'} className={`${tdBase} font-bold text-pink-700 border-r-2 border-blue-200 w-6`}>{cell(totF)}</td>,
                          ];
                        })}

                        {/* Summary columns */}
                        {SUMMARY_BRACKETS.flatMap(b => {
                          const mv = sumSummaryBracket(field,'M',b);
                          const fv = sumSummaryBracket(field,'F',b);
                          return [
                            <td key={'sum'+b+'M'} className={`${tdBase} text-purple-700 w-6`}>{cell(mv)}</td>,
                            <td key={'sum'+b+'F'} className={`${tdBase} text-purple-700 w-6`}>{cell(fv)}</td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <GridEdgeButtons edge={dohEdge} onStep={stepDoh} leftInFirstColumn />
          </div>
        </div>
      )}

      {/* ── INTERNAL REPORTS ── */}
      {activeReportTab === 'internal' && (
        <div className="space-y-4">
          <PanelShell>
            <UnderlineTabs<'treatment' | 'conditions' | 'admin'> name="Report section" value={internalSection} onChange={setInternalSection}
              options={SECTION_TILES.map(({ v, label, icon }) => ({ v, label, icon }))}
              trailing={
                <div className="flex">
                  {internalSection !== 'admin' && (
                    <FiltersButton count={activeStudentFilters}>
                      {[
                        { label: 'Age', value: intAgeFilter, set: (v: string) => { setIntAgeFilter(v); setIntGradeFilter('all'); }, opts: [['all', 'All ages'], ['4 & below', 'Age: 4 & below'], ['5-9', 'Age: 5-9'], ['10-14', 'Age: 10-14'], ['15-19', 'Age: 15-19'], ['20 & above', 'Age: 20 & above']] },
                        { label: 'Grade', value: intGradeFilter, set: (v: string) => { setIntGradeFilter(v); setIntAgeFilter('all'); }, opts: [['all', 'All grades'], ...ALL_GRADES_INT.map(g => [g, g])] },
                        { label: 'Sex', value: intGenderFilter, set: setIntGenderFilter, opts: [['all', 'All sex'], ['M', 'Male'], ['F', 'Female']] },
                      ].map((f) => (
                        <div key={f.label}>
                          <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{f.label}</div>
                          <select aria-label={f.label} value={f.value} onChange={(e) => f.set(e.target.value)}
                            className="h-10 w-full rounded-lg border border-[#e3e7ef] bg-[#f1f3f8] px-3 text-[13.5px] font-bold text-[#46536d]">
                            {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                      ))}
                    </FiltersButton>
                  )}
                  <ExportMenu joined={internalSection !== 'admin'} busy={internalXlsxBusy || (building && preview.kind === 'pdf')}
                    onPrint={() => window.print()} onPdf={handleInternalPdf} onExcel={() => { void handleInternalExcel(); }} />
                </div>
              } />
            {internalSection !== 'conditions' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-5 pt-6">
                  <>
                    <GroupBox title="Time period" icon={Clock} className="w-full lg:w-[400px]">
                      <PeriodSwitch<PeriodKind> name="Time period" value={periodType} onChange={setPeriodType}
                        options={[{ v: 'range', kind: 'range' }, { v: 'monthly', kind: 'month' }, { v: 'quarterly', kind: 'quarter' }, { v: 'biannual', kind: 'half' }, { v: 'annual', kind: 'year' }]} />
                    </GroupBox>
                    <GroupBox title="Dates" icon={CalendarDays} className="w-full lg:w-auto lg:px-6">
                      {periodType === 'range' ? (
                        <RangePicker start={rangeStart} end={rangeEnd} onChange={(a, b) => { setRangeStart(a); setRangeEnd(b); }} />
                      ) : (
                        <div className="flex w-full gap-5 lg:w-auto lg:gap-6">
                          {periodType !== 'annual' && (
                            <Underlined label={periodType === 'monthly' ? 'Month' : periodType === 'quarterly' ? 'Quarter' : 'Half'} icon={Calendar} chevron>
                              <select aria-label="Period" className={`${fieldInputClass} !pr-5`}
                                value={periodType === 'monthly' ? reportMonth : periodType === 'quarterly' ? Math.floor((reportMonth - 1) / 3) + 1 : reportMonth < 7 ? 1 : 2}
                                onChange={e => { const n = Number(e.target.value); setReportMonth(periodType === 'monthly' ? n : periodType === 'quarterly' ? (n - 1) * 3 + 1 : (n - 1) * 6 + 1); }}>
                                {periodType === 'monthly' && MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                {periodType === 'quarterly' && [1, 2, 3, 4].map(q => <option key={q} value={q}>Quarter {q} ({MONTHS[(q - 1) * 3].slice(0, 3)} to {MONTHS[q * 3 - 1].slice(0, 3)})</option>)}
                                {periodType === 'biannual' && [1, 2].map(h => <option key={h} value={h}>{h === 1 ? '1st half (Jan to Jun)' : '2nd half (Jul to Dec)'}</option>)}
                              </select>
                            </Underlined>
                          )}
                          <Underlined label="Year" icon={Calendar} chevron>
                            <select aria-label="Year" value={reportYear} onChange={e => setReportYear(Number(e.target.value))} className={`${fieldInputClass} !pr-5`}>
                              {Array.from(new Set([...[3, 2, 1, 0].map(i => new Date().getFullYear() - i), reportYear])).sort().map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                          </Underlined>
                        </div>
                      )}
                    </GroupBox>
                  </>
            </div>
            )}
            {internalSection !== 'admin' && activeStudentFilters > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">Showing</span>
                {intAgeFilter !== 'all' && <FilterChip onRemove={() => setIntAgeFilter('all')}>{`Age ${intAgeFilter}`}</FilterChip>}
                {intGradeFilter !== 'all' && <FilterChip onRemove={() => setIntGradeFilter('all')}>{intGradeFilter}</FilterChip>}
                {intGenderFilter !== 'all' && <FilterChip onRemove={() => setIntGenderFilter('all')}>{intGenderFilter === 'M' ? 'Male' : 'Female'}</FilterChip>}
                <button type="button" onClick={clearStudentFilters} className="ml-auto text-[13px] font-bold text-destructive hover:underline">Clear all</button>
              </div>
            )}
          </PanelShell>

          <div ref={internalRef} className="space-y-4">
          {/* ── TREATMENT SUMMARY ── */}
          {internalSection === 'treatment' && (
            <div className="space-y-4">

              {/* Table */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Procedure Counts</h3>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Procedure</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-blue-500 uppercase tracking-wide text-[10px]">Male</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-pink-500 uppercase tracking-wide text-[10px]">Female</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {TREATMENT_ROWS.map(p => {
                      const m = cnt(realTreatmentMatrix, p, 'M');
                      const f = cnt(realTreatmentMatrix, p, 'F');
                      const t = m + f;
                      return (
                        <tr key={p} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-foreground">{labelForCode.get(p) ?? p}</td>
                          <td className="px-4 py-2.5 text-center text-blue-700">{m}</td>
                          <td className="px-4 py-2.5 text-center text-pink-700">{f}</td>
                          <td className="px-4 py-2.5 text-center font-bold text-foreground">{t}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-50 border-t-2 border-border">
                      <td className="px-4 py-2.5 font-bold text-foreground">TOTAL</td>
                      <td className="px-4 py-2.5 text-center font-bold text-blue-700">{TREATMENT_ROWS.reduce((s,p)=>s+cnt(realTreatmentMatrix,p,'M'),0)}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-pink-700">{TREATMENT_ROWS.reduce((s,p)=>s+cnt(realTreatmentMatrix,p,'F'),0)}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-foreground">{TREATMENT_ROWS.reduce((s,p)=>s+cnt(realTreatmentMatrix,p,'all'),0)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
                <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-gray-100">
                  Counted from tooth-level treatment records; each is dated by its chart's charting date (tooth records carry no individual date).
                </p>
              </div>
            </div>
          )}

          {/* ── CONDITION SUMMARY ── */}
          {internalSection === 'conditions' && (
            <div className="space-y-4">

              {/* Summary cards */}
              {(() => {
                const orallyFit = cnt(conditionMatrix,'Orally Fit',intGenderFilter);
                const cariesP   = cnt(conditionMatrix,'Caries (Primary)',intGenderFilter);
                const cariesPerm= cnt(conditionMatrix,'Caries (Permanent)',intGenderFilter);
                const gingivitis= cnt(conditionMatrix,'Gingivitis',intGenderFilter);
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label:'Orally Fit',          value: orallyFit,          color:'text-green-700 bg-green-50 border-green-200' },
                      { label:'Caries (Primary)',     value: cariesP,            color:'text-red-700 bg-red-50 border-red-200' },
                      { label:'Caries (Permanent)',   value: cariesPerm,         color:'text-orange-700 bg-orange-50 border-orange-200' },
                      { label:'Gingivitis',           value: gingivitis,         color:'text-yellow-700 bg-yellow-50 border-yellow-200' },
                    ].map((c,i) => (
                      <div key={i} className={`rounded-xl border p-4 ${c.color}`}>
                        <div className="text-2xl font-bold mt-1">{c.value}</div>
                        <div className="text-xs mt-0.5 opacity-70">{c.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Chart */}
              <div className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Condition Distribution</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={CONDITIONS.map(c => ({ name: c, count: cnt(conditionMatrix, c, intGenderFilter) }))}
                    margin={{top:4,right:8,bottom:36,left:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{fontSize:10}} angle={-20} textAnchor="end" interval={0} />
                    <YAxis tick={{fontSize:11}} />
                    <Tooltip content={<ChartTooltip />} />
                    {/* cyan, not teal — see the note on CHART.cyan; the choice is deliberate */}
                    <Bar dataKey="count" name="Count" fill={CHART.cyan} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table — by grade */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Condition Counts by Grade</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] sticky left-0 bg-gray-50">Condition</th>
                        {displayGrades.map(g => <th key={g} className="text-center px-3 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap">{g}</th>)}
                        <th className="text-center px-4 py-2.5 font-semibold text-foreground uppercase tracking-wide text-[10px]">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {CONDITIONS.map(cond => (
                        <tr key={cond} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-foreground sticky left-0 bg-card">{cond}</td>
                          {displayGrades.map(g => (
                            <td key={g} className="px-3 py-2.5 text-center text-foreground">{getCount(conditionMatrix, cond, g, intGenderFilter)}</td>
                          ))}
                          <td className="px-4 py-2.5 text-center font-bold text-foreground">{cnt(conditionMatrix, cond, intGenderFilter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── ADMIN ── */}
          {internalSection === 'admin' && (
            <div className="space-y-4">
              {/* Quick Stats + Consent */}
              {(() => {
                const highRisk = realStudents.filter((s) => s.riskLevel === 'High').length;
                const mediumRisk = realStudents.filter((s) => s.riskLevel === 'Medium').length;
                const consentBySchool = schoolNames.map((school) => {
                  const inSchool = realStudents.filter((s) => s.school === school);
                  const complete = inSchool.filter((s) => s.consentStatus === 'complete').length;
                  return { school, complete, total: inSchool.length };
                });
                const totalComplete = realStudents.filter((s) => s.consentStatus === 'complete').length;
                const totalPending = realStudents.filter((s) => s.consentStatus === 'pending').length;
                return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-bold text-foreground mb-4">Quick Stats</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label:'High Risk Students',   value: highRisk,  color:'red',   Icon:AlertTriangle },
                      { label:'Medium Risk Students', value: mediumRisk,  color:'amber', Icon:AlertCircle   },
                      { label:'Sessions This Month',  value: 0,  color:'blue',  Icon:Calendar      },
                      { label:'Students Treated',     value: realTreatmentCount, color:'green', Icon:Users         },
                    ].map(s => (
                      <div key={s.label} className={`bg-${s.color}-50 rounded-xl p-4`}>
                        <s.Icon className={`w-5 h-5 text-${s.color}-600 mb-2`} />
                        <div className={`text-2xl font-bold text-${s.color}-700`}>{s.value}</div>
                        <div className={`text-xs text-${s.color}-600 mt-0.5`}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-bold text-foreground mb-4">Consent Compliance by School</h3>
                  <div className="space-y-4">
                    {consentBySchool.map((s, i) => {
                      const pct = s.total ? Math.round((s.complete/s.total)*100) : 0;
                      const color = [CHART.brand, CHART.teal, CHART.orange][i % 3];
                      return (
                        <div key={s.school}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-foreground">{getSchoolShortName(s.school)}</span>
                            <span className="text-xs font-bold" style={{color}}>{s.complete}/{s.total} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{width:`${pct}%`,backgroundColor:color}} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-center text-xs">
                    <div><div className="text-base font-bold text-success">{totalComplete}</div><div className="text-muted-foreground">Complete</div></div>
                    <div><div className="text-base font-bold text-yellow-600">{totalPending}</div><div className="text-muted-foreground">Pending</div></div>
                  </div>
                </div>
              </div>
                );
              })()}

              {/* Treatment Sessions */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Treatment Sessions</h3>
                  <span className="text-xs text-amber-700">{NOT_TRACKED}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-border">
                      <tr>{['Date','School','Grade / Section','Students','Treated','Procedures'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sessionRows.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                          There is no bulk-session model in the system, so nothing can be recorded here yet —
                          this is not an empty period. Individual treatments ARE recorded, and are counted
                          in the Procedure Counts table.
                        </td></tr>
                      ) : sessionRows.map((s, i) => {
                        const pct = Math.round((s.treated / s.students) * 100);
                        return (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{s.date}</td>
                            <td className="px-4 py-2.5 text-muted-foreground max-w-[140px] truncate">{getSchoolShortName(s.school)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2 font-medium text-foreground">
                                <GradePill grade={s.grade} />
                                <span>{s.section}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{s.students}</td>
                            <td className="px-4 py-2.5">
                              <span className="font-semibold text-foreground">{s.treated}</span>
                              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${pct===100?'bg-green-100 text-green-700':pct>=80?'bg-blue-100 text-blue-700':'bg-yellow-100 text-yellow-700'}`}>{pct}%</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {s.procedures.map((p, pi) => <span key={pi} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">{p}</span>)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Referral Tracking. Not for the School Admin (Sprint 163, SEC-33):
                  who was referred where, and why, is a clinical record; the
                  server also sends them no referral rows. */}
              {user?.role !== 'school_admin' && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Referral Tracking</h3>
                  <span className="text-xs text-muted-foreground">{referralRows.length} recorded</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-border">
                      <tr>{['Student','School','Grade','Date Issued','Facility','Reason','Follow-up','Status'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {referralRows.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                          No referrals recorded. Referrals are written on a student&apos;s record, under Referrals,
                          and are counted on the DOH Program Report from there.
                        </td></tr>
                      ) : referralRows.map((r, i) => (
                        // key on the FRAGMENT: with it on the inner <tr>, React
                        // warns on every render now that this list is non-empty.
                        <Fragment key={i}>
                        <tr {...activatable(() => setExpandedReferral(expandedReferral === i ? null : i))}
                          className="hover:bg-orange-50/40 cursor-pointer select-none">
                          <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{r.student}</td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-[120px] truncate">{getSchoolShortName(r.school)}</td>
                          <td className="px-4 py-2.5">
                            <GradePill grade={r.grade} />
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{r.date}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.facility}</td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-[160px] truncate">{r.reason}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{r.followUp}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full font-semibold capitalize text-[10px] ${r.status==='completed'?'bg-green-100 text-green-700':r.status==='no-show'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>{r.status}</span>
                          </td>
                        </tr>
                        {expandedReferral === i && (
                          <tr key={`${i}-detail`} className="bg-orange-50/60">
                            <td colSpan={8} className="px-6 py-3">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">Full Reason</span><span className="text-foreground">{r.reason}</span></div>
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">Referred To</span><span className="text-foreground">{r.facility}</span></div>
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">School</span><span className="text-foreground">{r.school}</span></div>
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">Date Issued</span><span className="text-foreground">{r.date}</span></div>
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">Expected Follow-up</span><span className="text-foreground">{r.followUp || '—'}</span></div>
                                <div><span className="font-semibold text-muted-foreground block mb-0.5">Status</span>
                                  <span className={`px-2 py-0.5 rounded-full font-semibold capitalize ${r.status==='completed'?'bg-green-100 text-green-700':r.status==='no-show'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>{r.status}</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── TARGET CLIENT LIST (Appendix E) ── */}
      {activeReportTab === 'tcl' && canSeeNamedClientLists && <TargetClientList />}

      {/* ── ORAL HEALTH PROGRAM REPORTING FORM (Appendix F) ── */}
      {activeReportTab === 'ohprf' && <OralHealthProgramReport schoolName={reportSchool} />}
      {activeReportTab === 'fhsis' && <FhsisReport schoolName={reportSchool} />}
      {/* Per-school summary sheet — shares the DOH tab's school-year picker,
          like the Program Report (Sprint 57b). */}
      {activeReportTab === 'summary' && <SchoolSummaryReport schoolYear={dohSchoolYear} schoolName={reportSchool} yearPicker={yearSelect} />}
      {/* No school/year props: the consent form is blank by design. */}
      {activeReportTab === 'consent' && canSeeNamedClientLists && <ConsentForm />}

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
