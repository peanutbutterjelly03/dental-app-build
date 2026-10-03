import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, FileText, Printer, Download, AlertTriangle, AlertCircle, CheckCircle, Users, Calendar, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { useAuth } from '../context/AuthContext';
import { getSchoolShortName } from '../utils/schoolColors';
import { CHART } from '../utils/chartColors';
import { GradePill } from './GradePill';
import { useDohReportData } from '../hooks/useDohReportData';
import { exportDohReportToPdf } from '../utils/exportPdf';
import { exportDohReportToXlsx } from '../utils/exportDohXlsx';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { apiClient } from '../api/client';
import type { ApiTreatment, ApiToothRecord, ApiDentalChart, ApiStudentIptr } from '../api/types';
import { useStudents } from '../hooks/useStudents';
import { TargetClientList } from './TargetClientList';
import { OralHealthProgramReport } from './OralHealthProgramReport';
import { SchoolSummaryReport } from './SchoolSummaryReport';
import { FhsisReport } from './FhsisReport';
import { ConsentForm } from './ConsentForm';
import { treatmentCodes } from './DentalChart';
import { schoolYearLabel } from '../utils/schoolYear';
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
  // dropped "5-9 yrs" here on the reasoning that a Grade 7 pupil is ~12 so
  // the cell can never be filled — but that argument proves too much: a Grade
  // 2 pupil is never 20 either, and the form still carries "20 yrs & above"
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

// No real Referral or bulk-Session-tracking model exists anywhere in the
// ERD -- these lists are genuinely empty until such a model is built, never
// fabricated placeholder rows.
const mockReferrals: { student:string; school:string; grade:string; date:string; facility:string; reason:string; followUp:string; status:string }[] = [];
const mockSessions: { date:string; school:string; grade:string; section:string; students:number; procedures:string[]; treated:number }[] = [];


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

export const Reports = () => {
  const { selectedSchool } = useAuth();
  // The DOH report covers a school year — this year's report is not next
  // year's (Sprint 57b). It used to count every record ever created, so it
  // could not answer "what did we do this year?" at all.
  // Declared here, above the hook call that consumes it — it used to sit
  // further down, which is fine until something above needs it.
  const [reportSchool, setReportSchool] = useState<string|null>(null);
  // School list comes from the DB now, not a hardcoded array (Sprint 60).
  const { schoolNames } = useSchools();
  const [dohSchoolYear, setDohSchoolYear] = useState<string | null>(() => schoolYearLabel());
  const { getRealCount, years: dohYears, unplacedCount, loading: dohLoading } = useDohReportData(dohSchoolYear, reportSchool);
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
  const [activeReportTab, setActiveReportTab] = useState<'doh'|'internal'|'tcl'|'ohprf'|'fhsis'|'summary'|'consent'>('doh');
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportYear,  setReportYear]  = useState(new Date().getFullYear());
  // Local school override — defaults to All Schools regardless of global context
  const dohReportRef = useRef<HTMLDivElement>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const { students: realStudents } = useStudents();

  // Only offer the 7-10 band where secondary pupils actually exist for the
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
  const [treatments, setTreatments] = useState<ApiTreatment[]>([]);
  const [toothRecords, setToothRecords] = useState<ApiToothRecord[]>([]);
  const [dentalCharts, setDentalCharts] = useState<ApiDentalChart[]>([]);
  const [iptrs, setIptrs] = useState<ApiStudentIptr[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [t, tr, dc, ip] = await Promise.all([
          apiClient.get<ApiTreatment[]>('/treatments'),
          apiClient.get<ApiToothRecord[]>('/tooth-records'),
          apiClient.get<ApiDentalChart[]>('/dental-charts'),
          apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
        ]);
        setTreatments(t);
        setToothRecords(tr);
        setDentalCharts(dc);
        setIptrs(ip);
      } catch (err) {
        console.error('Reports extra data fetch failed:', err);
      }
    })();
  }, []);

  const handleDownloadPdf = async () => {
    if (!dohReportRef.current) return;
    setDownloadingPdf(true);
    setDownloadError(null);
    try {
      const schoolPart = reportSchool ? getSchoolShortName(reportSchool).replace(/\s+/g, '_') : 'AllSchools';
      const filename = `DOH_Report_${schoolPart}_${bandSlug}_${MONTHS[reportMonth - 1]}${reportYear}.pdf`;
      await exportDohReportToPdf(dohReportRef.current, filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to generate PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    setDownloadError(null);
    try {
      const schoolPart = reportSchool ? getSchoolShortName(reportSchool).replace(/\s+/g, '_') : 'AllSchools';
      await exportDohReportToXlsx({
        grades: visibleGrades,
        gradeBrackets: GRADE_BRACKETS,
        summaryBrackets: SUMMARY_BRACKETS,
        rows: visibleDohRows,
        getCell: (g, a, s, f) => V(g, a, s, f),
        school: reportSchool ? getSchoolShortName(reportSchool) : 'All Schools',
        // The spreadsheet has to say it is shortened: unlike the printout,
        // a file gets forwarded without the screen it came from.
        monthYear: `${MONTHS[reportMonth - 1]} ${reportYear} · ${bandLabel}${dohHiddenCount ? ` · SHORTENED — ${hiddenDohRows.size} row(s), ${hiddenGrades.size} grade(s) hidden` : ''}`,
        filename: `DOH_Consolidated_${schoolPart}_${bandSlug}_${MONTHS[reportMonth - 1]}${reportYear}.xlsx`,
      });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to generate Excel');
    } finally {
      setDownloadingExcel(false);
    }
  };
  const [internalSection, setInternalSection] = useState<'treatment'|'conditions'|'admin'>('treatment');
  const [periodType, setPeriodType] = useState<'monthly'|'quarterly'|'biannual'|'annual'>('monthly');
  const [intSchoolFilter, setIntSchoolFilter] = useState('all');
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
    if (periodType === 'monthly')   return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    if (periodType === 'quarterly') { const q = Math.floor(m / 3) * 3; return { start: new Date(y, q, 1), end: new Date(y, q + 3, 1) }; }
    if (periodType === 'biannual')  { const h = m < 6 ? 0 : 6; return { start: new Date(y, h, 1), end: new Date(y, h + 6, 1) }; }
    return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }, [periodType, reportMonth, reportYear]);
  const periodLabel = periodType === 'monthly'
    ? `${MONTHS[reportMonth - 1]} ${reportYear}`
    : `${periodRange.start.toLocaleDateString('en-US', { month: 'short' })}–${new Date(periodRange.end.getFullYear(), periodRange.end.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'short' })} ${reportYear}`;

  // Real per-procedure counts from tooth-level treatment records. Tooth
  // records carry no date of their own, so each is dated by its chart's
  // date_charted (the closest real date the ERD provides — noted in the UI).
  const TREATMENT_ROWS = useMemo(() => treatmentCodes.map((t) => t.label), []);
  const realTreatmentMatrix = useMemo(() => {
    const inPeriod = (d: string) => { const t = new Date(d); return t >= periodRange.start && t < periodRange.end; };
    const chartById = new Map(dentalCharts.map((c) => [c._id, c]));
    const iptrById = new Map(iptrs.map((i) => [i._id, i]));
    const studentById = new Map(realStudents.map((s) => [s.id, s]));
    const matrix: Record<string, GX> = {};
    for (const tr of toothRecords) {
      if (!tr.treatment_code) continue;
      const chart = chartById.get(tr.chart_id);
      if (!chart || !inPeriod(chart.date_charted)) continue;
      const iptr = iptrById.get(chart.iptr_id);
      const student = iptr ? studentById.get(iptr.student_id) : undefined;
      if (!student) continue;
      if (intSchoolFilter !== 'all' && student.school !== intSchoolFilter) continue;
      const label = treatmentCodes.find((c) => c.code === tr.treatment_code)?.label ?? tr.treatment_code;
      const sex: 'M' | 'F' = student.gender === 'Male' ? 'M' : 'F';
      const row = (matrix[label] ??= {});
      for (const g of [student.grade, 'all']) {
        const cell = (row[g] ??= { M: 0, F: 0 });
        cell[sex] += 1;
      }
    }
    return matrix;
  }, [toothRecords, dentalCharts, iptrs, realStudents, intSchoolFilter, periodRange]);

  // Treatment entries (the Treatment model has real per-entry dates) within
  // the same period + school filter, for the "Students Treated" card.
  const periodTreatmentCount = useMemo(() => {
    const inPeriod = (d: string) => { const t = new Date(d); return t >= periodRange.start && t < periodRange.end; };
    const iptrById = new Map(iptrs.map((i) => [i._id, i]));
    const studentById = new Map(realStudents.map((s) => [s.id, s]));
    return treatments.filter((t) => {
      if (!inPeriod(t.date)) return false;
      if (intSchoolFilter === 'all') return true;
      const iptr = iptrById.get(t.iptr_id);
      const student = iptr ? studentById.get(iptr.student_id) : undefined;
      return student?.school === intSchoolFilter;
    }).length;
  }, [treatments, iptrs, realStudents, intSchoolFilter, periodRange]);
  const realTreatmentCount = treatments.length; // all-time, for the admin Overview tab
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
  const clearIntFilters = () => { setIntSchoolFilter('all'); setIntGradeFilter('all'); setIntGenderFilter('all'); setIntAgeFilter('all'); };
  const hasIntFilters = intSchoolFilter !== 'all' || intGradeFilter !== 'all' || intGenderFilter !== 'all' || intAgeFilter !== 'all';

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

  if (dohLoading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — title left, controls right */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">DOH Consolidated Report &amp; Internal Reports</p>
        </div>
        <div className="doh-report-controls flex items-center gap-2 flex-shrink-0">
          <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))}
            className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring">
            {MONTHS.map((m,i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
          <select value={reportYear} onChange={e => setReportYear(Number(e.target.value))}
            className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring">
            {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium whitespace-nowrap">
            <Printer className="w-4 h-4" /> Print
          </button>
          {activeReportTab === 'doh' && (
            <button onClick={handleDownloadPdf} disabled={downloadingPdf}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium whitespace-nowrap">
              <Download className="w-4 h-4" /> {downloadingPdf ? 'Generating…' : 'Download PDF'}
            </button>
          )}
          {activeReportTab === 'doh' && (
            <button onClick={handleDownloadExcel} disabled={downloadingExcel}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-60 text-sm font-medium whitespace-nowrap">
              <FileSpreadsheet className="w-4 h-4" /> {downloadingExcel ? 'Generating…' : 'Download Excel'}
            </button>
          )}
        </div>
      </div>
      {downloadError && (
        <div className="text-sm text-destructive bg-red-50 border border-red-200 rounded-lg px-4 py-2">{downloadError}</div>
      )}

      {/* Tabs — scroll inside their own container: six tabs no longer fit a
          390px phone, and the three-device-classes rule forbids letting a
          control row push the page sideways. `w-fit` alone would overflow. */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        <button onClick={() => setActiveReportTab('doh')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeReportTab==='doh' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileSpreadsheet className="w-4 h-4" /> DOH Consolidated
        </button>
        <button onClick={() => setActiveReportTab('internal')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeReportTab==='internal' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileText className="w-4 h-4" /> Internal Reports
        </button>
        <button onClick={() => setActiveReportTab('tcl')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeReportTab==='tcl' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Users className="w-4 h-4" /> Target Client List
        </button>
        <button onClick={() => setActiveReportTab('ohprf')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeReportTab==='ohprf' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileSpreadsheet className="w-4 h-4" /> Program Report
        </button>
        <button onClick={() => setActiveReportTab('fhsis')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeReportTab==='fhsis' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileSpreadsheet className="w-4 h-4" /> FHSIS
        </button>
        <button onClick={() => setActiveReportTab('summary')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeReportTab==='summary' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileSpreadsheet className="w-4 h-4" /> School Summary
        </button>
        <button onClick={() => setActiveReportTab('consent')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeReportTab==='consent' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileText className="w-4 h-4" /> Consent Form
        </button>
      </div>

      {/* ── DOH CONSOLIDATED ── */}
      {activeReportTab === 'doh' && (
        <div className="space-y-3">
          {/* School filter — thin bar, doesn't scroll */}
          <div className="doh-report-controls flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap" htmlFor="doh-school">School:</label>
            <select id="doh-school" aria-label="School" value={reportSchool ?? ''} onChange={e => setReportSchool(e.target.value || null)}
              className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All Schools</option>
              {schoolNames.map(s => <option key={s} value={s}>{getSchoolShortName(s)}</option>)}
            </select>

            {/* School year, not calendar month: the DOH figures below are
                per-IPTR, and an IPTR belongs to a school year. */}
            <label className="text-sm text-muted-foreground whitespace-nowrap" htmlFor="doh-school-year">School year:</label>
            <select id="doh-school-year" aria-label="School year" value={dohSchoolYear ?? ''} onChange={e => setDohSchoolYear(e.target.value || null)}
              className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring">
              {/* Kept available deliberately — it is what this report did before
                  it could be scoped, and it is still the right answer for a
                  cumulative count. */}
              <option value="">All years to date</option>
              {dohYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <button
              onClick={() => setShowDohPicker((v) => !v)}
              aria-expanded={showDohPicker}
              className="text-sm px-3 py-2 border border-border rounded-lg text-foreground hover:bg-gray-50"
            >{showDohPicker ? 'Done' : `Rows & grades${dohHiddenCount ? ` (${dohHiddenCount} hidden)` : ''}`}</button>

            {/* Same DOH form, different grade band. Hidden entirely when the
                school in view has no secondary pupils. */}
            {hasSecondary && (
              <div role="group" aria-label="Grade band" className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {([['elem','Kinder–Grade 6'],['hs','Grade 7–10']] as const).map(([band, label]) => (
                  <button
                    key={band}
                    onClick={() => setGradeBand(band)}
                    aria-pressed={gradeBand === band}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      gradeBand === band ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* How the two year-varying figures in this table are derived. Both
              used to be computed against TODAY, which silently rewrote past
              reports every time a pupil was promoted or had a birthday. */}
          <p className="text-xs text-muted-foreground">
            {dohSchoolYear
              ? <>Covering school year <span className="font-medium text-foreground">{dohSchoolYear}</span>. Grade is the grade recorded for that year, and age is the pupil&apos;s age at that year&apos;s first recorded visit (or the start of the school year where no visit is recorded) — not their grade or age today.</>
              : <>Covering <span className="font-medium text-foreground">all years to date</span>, so a pupil with several school years is counted once per year. Pick a school year above to report on one.</>}
            {unplacedCount > 0 && (
              <> <span className="font-medium text-foreground">{unplacedCount} record{unplacedCount === 1 ? '' : 's'}</span> in this range predate grade being stored per school year, so {unplacedCount === 1 ? 'it appears' : 'they appear'} in the totals but in no grade column.</>
            )}
          </p>

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
          <div id="doh-report-printable" className="bg-card rounded-xl border border-border overflow-hidden">
            {/* ref goes on the scrollable inner div, not the overflow-hidden outer
                one — html2canvas clips to the ref'd element's own rendered box,
                so ref'ing the outer div only captured the already-clipped width. */}
            <div ref={dohReportRef} className="overflow-x-auto">
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
              <table style={{borderCollapse:'collapse', fontSize:'10px', whiteSpace:'nowrap'}}>
                {/* ── TITLE ── */}
                <thead>
                  <tr>
                    <th colSpan={1 + cols.length*2 + sumCols.length*2 + 2}
                      className="text-center py-2 px-3 bg-gray-50 border-b border-border text-[11px] font-bold text-foreground uppercase tracking-wide">
                      DENTAL SECTION — CONSOLIDATED ORAL HEALTH STATUS AND SERVICE REPORT
                    </th>
                  </tr>
                  <tr>
                    <th colSpan={1 + cols.length*2 + sumCols.length*2 + 2}
                      className="text-center py-1 px-3 bg-gray-50 border-b border-border text-[10px] text-muted-foreground">
                      SCHOOL: {reportSchool ? getSchoolShortName(reportSchool) : 'All Schools'} &nbsp;·&nbsp;
                      MONTH: {MONTHS[reportMonth-1]} {reportYear} &nbsp;·&nbsp;
                      GRADES: {bandLabel}
                    </th>
                  </tr>

                  {/* ── ROW 1: GRADE HEADERS ── */}
                  <tr className="bg-gray-50 border-b border-border">
                    <th data-doh="indicator" rowSpan={3} className="sticky left-0 bg-gray-50 z-20 text-left px-2 py-1 border-r border-border text-[10px] font-semibold text-muted-foreground min-w-[240px]">
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
                  <tr className="bg-gray-50 border-b border-border">
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
                  <tr className="bg-gray-50 border-b-2 border-border">
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
                          <td className="sticky left-0 z-10 px-3 py-1 font-bold text-blue-900 text-[10px] uppercase tracking-wide bg-blue-50 min-w-[240px]">
                            {row.label}
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
                        <td className={`sticky left-0 bg-card group-hover:bg-yellow-50 border-r border-border px-2 py-0.5 text-[10px] transition-colors ${labelPadding} min-w-[240px]`}>
                          {row.label}
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
              {/* Footer lives INSIDE the ref'd (captured) div so it appears in
                  the PDF. sticky left-0 keeps it from scrolling horizontally
                  with the table on screen (same trick as the Indicator column),
                  and it still renders at the left in the capture (scrollLeft 0). */}
              <div className="sticky left-0 bg-card px-4 py-2 border-t border-gray-100 flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
                <span>Prepared by: Dr. Maria Santos, Dentist · Barangay Tanyag Dental Clinic</span>
                <span>{MONTHS[reportMonth-1]} {reportYear}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── INTERNAL REPORTS ── */}
      {activeReportTab === 'internal' && (
        <div className="space-y-4">
          {/* Section sub-tabs */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {([['treatment','Treatment Summary'],['conditions','Condition Summary'],['admin','Overview']] as const).map(([k,l]) => (
              <button key={k} onClick={() => setInternalSection(k)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${internalSection===k ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* ── TREATMENT SUMMARY ── */}
          {internalSection === 'treatment' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                  {(['monthly','quarterly','biannual','annual'] as const).map(p => (
                    <button key={p} onClick={() => setPeriodType(p)}
                      className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${periodType===p ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}>
                      {p === 'biannual' ? 'Bi-annual' : p}
                    </button>
                  ))}
                </div>
                <select value={intSchoolFilter} onChange={e => setIntSchoolFilter(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Schools</option>
                  {schoolNames.map(s => <option key={s} value={s}>{getSchoolShortName(s)}</option>)}
                </select>
                <select value={intAgeFilter} onChange={e => { setIntAgeFilter(e.target.value); setIntGradeFilter('all'); }}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Ages</option>
                  <option value="4 & below">4 & below</option>
                  <option value="5-9">5-9</option>
                  <option value="10-14">10-14</option>
                  <option value="15-19">15-19</option>
                  <option value="20 & above">20 & above</option>
                </select>
                <select value={intGradeFilter} onChange={e => { setIntGradeFilter(e.target.value); setIntAgeFilter('all'); }}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Grades</option>
                  {ALL_GRADES_INT.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={intGenderFilter} onChange={e => setIntGenderFilter(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Genders</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
                {hasIntFilters && (
                  <button onClick={clearIntFilters}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-destructive border border-red-200 rounded-lg hover:bg-red-50">
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
                <span className="text-xs text-muted-foreground ml-auto">{periodLabel}</span>
              </div>

              {/* Summary cards */}
              {(() => {
                const totals = TREATMENT_ROWS.map(p => cnt(realTreatmentMatrix, p, intGenderFilter));
                const grandTotal = totals.reduce((a,b) => a+b, 0);
                const topIdx = totals.indexOf(Math.max(...totals));
                // With no real per-procedure breakdown, every total is 0 --
                // indexOf(max) would misleadingly point at PROCEDURES[0] as
                // if it were genuinely "most common". Only claim a most-
                // common procedure when there's real data behind it.
                const mostCommon = grandTotal > 0 ? TREATMENT_ROWS[topIdx] : 'N/A';
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label:'Total Procedures', value: grandTotal, color:'text-blue-700 bg-blue-50 border-blue-200' },
                      { label:'Most Common', value: mostCommon, color:'text-green-700 bg-green-50 border-green-200', small: true },
                      { label:'Sessions', value: mockSessions.length, color:'text-cyan-700 bg-cyan-50 border-cyan-200' },
                      { label:'Students Treated', value: periodTreatmentCount, color:'text-purple-700 bg-purple-50 border-purple-200' },
                    ].map((c,i) => (
                      <div key={i} className={`rounded-xl border p-4 ${c.color}`}>
                        <div className={`font-bold mt-1 ${(c as any).small ? 'text-sm' : 'text-2xl'}`}>{c.value}</div>
                        <div className="text-xs mt-0.5 opacity-70">{c.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Chart */}
              <div className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Procedures Performed</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={TREATMENT_ROWS.map(p => ({ name: p, count: cnt(realTreatmentMatrix, p, intGenderFilter) }))}
                    margin={{top:4,right:8,bottom:40,left:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{fontSize:10}} angle={-25} textAnchor="end" interval={0} />
                    <YAxis tick={{fontSize:11}} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Count" fill={CHART.brand} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Procedure Counts</h3>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-gray-50 text-muted-foreground">
                    <Printer className="w-3 h-3" /> Print
                  </button>
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
                          <td className="px-4 py-2.5 font-medium text-foreground">{p}</td>
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
              {/* Filters */}
              <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
                <select value={intAgeFilter} onChange={e => { setIntAgeFilter(e.target.value); setIntGradeFilter('all'); }}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Ages</option>
                  <option value="4 & below">4 & below</option>
                  <option value="5-9">5-9</option>
                  <option value="10-14">10-14</option>
                  <option value="15-19">15-19</option>
                  <option value="20 & above">20 & above</option>
                </select>
                <select value={intGradeFilter} onChange={e => { setIntGradeFilter(e.target.value); setIntAgeFilter('all'); }}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Grades</option>
                  {ALL_GRADES_INT.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={intGenderFilter} onChange={e => setIntGenderFilter(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="all">All Genders</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
                {hasIntFilters && (
                  <button onClick={clearIntFilters}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-destructive border border-red-200 rounded-lg hover:bg-red-50">
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>

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
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-gray-50 text-muted-foreground">
                    <Printer className="w-3 h-3" /> Print
                  </button>
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
                  <span className="text-xs text-muted-foreground">{mockSessions.length} sessions recorded</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-border">
                      <tr>{['Date','School','Grade / Section','Students','Treated','Procedures'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {mockSessions.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No treatment sessions recorded yet.</td></tr>
                      ) : mockSessions.map((s, i) => {
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

              {/* Referral Tracking */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Referral Tracking</h3>
                  <span className="text-xs text-muted-foreground">{mockReferrals.length} referrals issued</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-border">
                      <tr>{['Student','School','Grade','Date Issued','Facility','Reason','Follow-up','Status'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {mockReferrals.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No referrals recorded yet.</td></tr>
                      ) : mockReferrals.map((r, i) => (
                        <>
                        <tr key={i} {...activatable(() => setExpandedReferral(expandedReferral === i ? null : i))}
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
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TARGET CLIENT LIST (Appendix E) ── */}
      {activeReportTab === 'tcl' && <TargetClientList />}

      {/* ── ORAL HEALTH PROGRAM REPORTING FORM (Appendix F) ── */}
      {activeReportTab === 'ohprf' && <OralHealthProgramReport schoolYear={dohSchoolYear} schoolName={reportSchool} />}
      {activeReportTab === 'fhsis' && <FhsisReport schoolName={reportSchool} />}
      {/* Per-school summary sheet — shares the DOH tab's school-year picker,
          like the Program Report (Sprint 57b). */}
      {activeReportTab === 'summary' && <SchoolSummaryReport schoolYear={dohSchoolYear} schoolName={reportSchool} />}
      {/* No school/year props: the consent form is blank by design. */}
      {activeReportTab === 'consent' && <ConsentForm />}
    </div>
  );
};
