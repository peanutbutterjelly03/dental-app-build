import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, ChevronLeft, ChevronRight, Shield, ShieldCheck, ShieldAlert, Users, TrendingUp, FileText, Plus, Pencil, Trash2, Brain, Download, X } from 'lucide-react';
import { exportDohReportToPdf } from '../utils/exportPdf';
import { getGradeColor } from '../utils/gradeColors';
import { computeBmi, BMI_NOTE } from '../utils/bmi';
import { useAuth } from '../context/AuthContext';
import { GradePill } from './GradePill';
import { useToast } from './Toast';
import { useStudents } from '../hooks/useStudents';
import { useDentalChartData } from '../hooks/useDentalChartData';
import { apiClient, ApiError } from '../api/client';
import { toLocalDateString, formatDate } from '../utils/localDate';
import { surnameFirst, surnameFirstWithInitial } from '../utils/studentName';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { useSchools } from '../hooks/useSchools';

// ─── FDI tooth layout ─────────────────────────────────────────────────────────
const upperPermanent = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const lowerPermanent = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const upperTemporary = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const lowerTemporary = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
const temporaryTeeth = new Set([...upperTemporary, ...lowerTemporary]);

const conditionColors: Record<string, string> = {
  '✓': 'bg-green-50 border-green-400',
  '√': 'bg-green-50 border-green-400',
  'D': 'bg-red-100 border-red-400',
  'd': 'bg-red-100 border-red-300',
  'M': 'bg-slate-200 border-slate-400',
  'm': 'bg-slate-200 border-slate-300',
  'F': 'bg-blue-100 border-blue-400',
  'f': 'bg-blue-100 border-blue-300',
  'X': 'bg-orange-100 border-orange-400',
  'x': 'bg-orange-100 border-orange-300',
  // Legacy: charts saved before the code was corrected to X/x still hold DX/dx.
  'DX': 'bg-orange-100 border-orange-400',
  'dx': 'bg-orange-100 border-orange-300',
  'Un': 'bg-purple-50 border-purple-300',
  'un': 'bg-purple-50 border-purple-200',
  'S': 'bg-yellow-50 border-yellow-400',
  's': 'bg-yellow-50 border-yellow-300',
  'JC': 'bg-pink-50 border-pink-400',
  'jc': 'bg-pink-50 border-pink-300',
  'P': 'bg-indigo-50 border-indigo-400',
  'p': 'bg-indigo-50 border-indigo-300',
};

const ALL_SCHOOL_YEARS = ['2023-2024', '2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029', '2029-2030'];
const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

type ChartEntry = { condition: string; treatment: string };
type MedicalHistoryDraft = {
  allergies: string; hypertension: boolean; diabetes: boolean; bloodDisorders: boolean;
  cardiovascular: boolean; thyroid: boolean; hepatitis: boolean; malignancy: boolean;
  hospitalization: boolean; bloodTransfusion: boolean; tattoo: boolean; others: string;
};
type DietDraft = {
  sugarSweetened: boolean; alcoholDrinker: boolean; tobaccoUser: boolean; betelNut: boolean;
  bodyPiercing: boolean; nailBiting: boolean; thumbsucking: boolean;
};
type OralDraft = {
  gingivitis: boolean; periodontal: boolean; debris: boolean; calculus: boolean;
  abnormalGrowth: boolean; cleftLipPalate: boolean; oralHygiene: string; others: string;
};

const emptyMed = (): MedicalHistoryDraft => ({
  allergies: '', hypertension: false, diabetes: false, bloodDisorders: false, cardiovascular: false,
  thyroid: false, hepatitis: false, malignancy: false, hospitalization: false, bloodTransfusion: false,
  tattoo: false, others: '',
});
const emptyDiet = (): DietDraft => ({
  sugarSweetened: false, alcoholDrinker: false, tobaccoUser: false, betelNut: false,
  bodyPiercing: false, nailBiting: false, thumbsucking: false,
});
const emptyOral = (): OralDraft => ({
  gingivitis: false, periodontal: false, debris: false, calculus: false,
  abnormalGrowth: false, cleftLipPalate: false, oralHygiene: '', others: '',
});

const formatDateStamp = (dateString?: string | null) => formatDate(dateString, 'No date stamp');

// ─── DMFT calculation ─────────────────────────────────────────────────────────
const computeDMFT = (chart: Record<number, ChartEntry>) => {
  let d = 0, m = 0, f = 0, x = 0, D = 0, M = 0, F = 0, X = 0;
  Object.entries(chart).forEach(([tooth, data]) => {
    const n = parseInt(tooth);
    const c = data.condition;
    if (temporaryTeeth.has(n)) {
      if (c === 'd') d++;
      else if (c === 'm') m++;
      else if (c === 'f') f++;
      else if (c === 'x' || c === 'dx') x++;
    } else {
      if (c === 'D') D++;
      else if (c === 'M') M++;
      else if (c === 'F') F++;
      else if (c === 'X' || c === 'DX') X++;
    }
  });
  return { d, m, f, x, t: d + m + f + x, D, M, F, X, T: D + M + F + X };
};

// Base44-exact condition codes: uppercase=permanent, lowercase=temporary (auto-applied)
const conditionCodes = [
  { code: '✓', label: 'Sound/Sealed', perm: '✓', temp: '✓' },
  { code: 'D', label: 'Decayed', perm: 'D', temp: 'd' },
  { code: 'M', label: 'Missing', perm: 'M', temp: 'm' },
  { code: 'F', label: 'Filled', perm: 'F', temp: 'f' },
  { code: 'X', label: 'Indicated for Extr.', perm: 'X', temp: 'x' },
  { code: 'Un', label: 'Unerupted', perm: 'Un', temp: 'un' },
  { code: 'S', label: 'Supernumerary Tooth', perm: 'S', temp: 's' },
  { code: 'JC', label: 'Jacket Crown', perm: 'JC', temp: 'jc' },
  { code: 'P', label: 'Pontic', perm: 'P', temp: 'p' },
];

// Base44-exact treatment codes
// `local` is the word the clinic and the families actually use. The clinical
// term stays primary — DOH forms and the manuscript use it — and the local term
// is shown beside it so staff reading a screen mid-appointment, and a parent
// looking over their shoulder, both recognise the service. "Pasta" was already
// carried on TR before this; the rest were added 2026-09-02.
//
// ⚠ Only terms the dentist confirms should live here. A wrong local word on a
// clinical screen is worse than none — leave `local` off rather than guess.
export const treatmentCodes = [
  { code: 'OEX', label: 'Oral Exam / Checkup', local: 'Tingin' },
  { code: 'FV', label: 'Fluoride Varnish' },
  { code: 'PFS', label: 'Pit and Fissure Sealant' },
  { code: 'OP', label: 'Oral Prophylaxis', local: 'Linis' },
  { code: 'PF', label: 'Permanent Filling', local: 'Pasta' },
  { code: 'TF', label: 'Temporary Filling', local: 'Pansamantalang pasta' },
  { code: 'TR', label: 'Tooth Restoration', local: 'Pasta' },
  { code: 'X', label: 'Extraction', local: 'Bunot' },
  { code: 'SDF', label: 'Silver Diamine Fluoride' },
];

/** "Extraction (Bunot)" where a local term exists, otherwise just the label. */
export const treatmentLabel = (t: { label: string; local?: string }) =>
  t.local ? `${t.label} (${t.local})` : t.label;

// ─── Main component ───────────────────────────────────────────────────────────
export const DentalChart = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const { user, selectedSchool } = useAuth();
  const canEdit = user?.role === 'dentist';
  const canEditHistory = user?.role === 'dentist' || user?.role === 'dental_aide';
  const canEditInfo = canEditHistory;
  const staffNameLabel = user?.role === 'dental_aide' ? 'Dental Aide' : 'Dentist';

  const { students: allStudents } = useStudents();
  // School list comes from the DB now, not a hardcoded array (Sprint 60).
  const { schoolNames } = useSchools();
  const { student, schoolName, years, dentists, loading, error, reload } = useDentalChartData(id);
  const currentDentist = dentists.find((d) => d.user_id === user?.id);

  // Real patient nav (school-scoped like every list page, sorted by name for a stable, predictable order)
  const navList = useMemo(
    () => (selectedSchool ? allStudents.filter((s) => s.school === selectedSchool) : [...allStudents]).sort((a, b) => a.name.localeCompare(b.name)),
    [allStudents, selectedSchool],
  );
  const navIndex = navList.findIndex((s) => s.id === id);
  const prevPatient = navIndex > 0 ? navList[navIndex - 1] : null;
  const nextPatient = navIndex >= 0 && navIndex < navList.length - 1 ? navList[navIndex + 1] : null;

  type TabKey = 'history' | 'chart' | 'appointments' | 'records' | 'treatments' | 'referrals' | 'ai';
  type IptrContext = 'default' | 'dental-queue' | 'risk' | 'treatment';
  const iptrContext = (searchParams.get('context') as IptrContext) || 'default';
  const initialTab = (searchParams.get('tab') as TabKey) || 'history';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const allTabs: { key: TabKey; label: string }[] = [
    { key: 'appointments', label: 'Consent' },
    { key: 'history', label: 'History' },
    { key: 'chart', label: 'Dental Chart' },
    { key: 'treatments', label: 'Treatment History' },
    { key: 'records', label: 'DMFT History' },
    { key: 'referrals', label: 'Referrals' },
    { key: 'ai', label: 'Risk Classification' },
  ];
  const visibleTabs = (
    iptrContext === 'dental-queue'
      ? allTabs.filter((tab) => tab.key === 'history' || tab.key === 'chart')
      : iptrContext === 'risk'
      ? allTabs.filter((tab) => tab.key === 'ai')
      : iptrContext === 'treatment'
      ? allTabs.filter((tab) => tab.key === 'chart' || tab.key === 'treatments')
      : allTabs
  );

  const [selectedYear, setSelectedYear] = useState(0);
  useEffect(() => {
    // Default to the most recent school year once data loads.
    if (years.length > 0) setSelectedYear(years.length - 1);
  }, [years.length, id]);

  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [selectedTreatment, setSelectedTreatment] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<'condition' | 'treatment' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // View-by-default (like the Patient Info card): clinical fields are a read
  // view until the dentist explicitly enters edit mode — a stray click can no
  // longer flip a medical flag. A brand-new/empty year auto-enters edit mode.
  const [editMode, setEditMode] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [draftInfo, setDraftInfo] = useState<Partial<typeof student>>({});
  // Height and weight live on the SELECTED YEAR's IPTR, not on STUDENT, so they
  // are drafted separately even though they share the one Edit button — the
  // save below writes to both records (Sprint 68).
  const [draftYear, setDraftYear] = useState<{ height_cm: string; weight_kg: string; grade_level: string; section: string }>({ height_cm: '', weight_kg: '', grade_level: '', section: '' });
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [isManagingYears, setIsManagingYears] = useState(false);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  // Wraps the record body for the PDF export, excluding the sticky toolbar —
  // a downloaded patient record should not carry Edit/Save buttons.
  const recordRef = useRef<HTMLDivElement | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const tabsRowRef = useRef<HTMLDivElement | null>(null);
  const [stickyOffsets, setStickyOffsets] = useState({ tabsTop: 0, yearTop: 0 });

  const currentYearData = years[selectedYear];

  // Draft (editable) copies of the current year's real data -- initialized
  // from real records when the selected year changes, persisted for real on
  // Save. This mirrors the app's existing form pattern (local draft state,
  // explicit save), just backed by real data instead of fake arrays.
  const [draftChart, setDraftChart] = useState<Record<number, ChartEntry>>({});
  const [draftMed, setDraftMed] = useState<MedicalHistoryDraft>(emptyMed());
  const [draftDiet, setDraftDiet] = useState<DietDraft>(emptyDiet());
  const [draftOral, setDraftOral] = useState<OralDraft>(emptyOral());

  useEffect(() => {
    if (!currentYearData) {
      setDraftChart({});
      setDraftMed(emptyMed());
      setDraftDiet(emptyDiet());
      setDraftOral(emptyOral());
      setEditMode(false);
      return;
    }
    const chart: Record<number, ChartEntry> = {};
    for (const tr of currentYearData.toothRecords) {
      chart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
    }
    setDraftChart(chart);

    const mh = currentYearData.medicalHistory;
    setDraftMed(mh ? {
      allergies: mh.allergies, hypertension: mh.hypertension, diabetes: mh.diabetes_mellitus,
      bloodDisorders: false, cardiovascular: mh.cardiovascular_disease, thyroid: mh.thyroid_disorders,
      hepatitis: mh.hepatitis_disorders, malignancy: mh.malignancy, hospitalization: mh.previous_hospitalization,
      bloodTransfusion: mh.blood_transfusion, tattoo: mh.tattoo, others: mh.others,
    } : emptyMed());

    const dh = currentYearData.dietaryHabits;
    setDraftDiet(dh ? {
      sugarSweetened: dh.sugar_beverages, alcoholDrinker: dh.alcohol_drinker, tobaccoUser: dh.tobacco_user,
      betelNut: dh.betel_nut_chewer, bodyPiercing: dh.body_piercing, nailBiting: dh.nail_biting, thumbsucking: dh.thumb_sucking,
    } : emptyDiet());

    const oc = currentYearData.oralCondition;
    setDraftOral(oc ? {
      gingivitis: oc.gingivitis, periodontal: oc.periodontal_disease, debris: oc.debris, calculus: oc.calculus,
      abnormalGrowth: oc.abnormal_growth, cleftLipPalate: oc.cleft_lip_palate, oralHygiene: oc.oral_hygiene, others: oc.others,
    } : emptyOral());

    // Empty year (nothing recorded yet) exists to be filled — drop clinical
    // staff straight into edit mode; anything with data opens as a read view.
    setEditMode(
      (user?.role === 'dentist' || user?.role === 'dental_aide') &&
      !currentYearData.medicalHistory && !currentYearData.oralCondition &&
      currentYearData.toothRecords.length === 0,
    );
  }, [selectedYear, currentYearData, user?.role]);

  // Effective edit rights: role AND edit mode. Aides keep read-only here —
  // they could tick history boxes before, but Save was always dentist-only,
  // so those edits silently went nowhere (dead UI, now honest).
  const editingChart = canEdit && editMode;
  const editingHistory = canEditHistory && editMode;

  const cancelEdit = async () => {
    setEditMode(false);
    await reload(); // refetch → draft-sync effect resets all drafts
  };

  const currentChart = draftChart;
  const dmft = computeDMFT(currentChart);
  // Coloured by the SELECTED YEAR's grade, not the student's current one — a
  // 2025-2026 record tinted with this year's grade colour is the same quiet
  // lie the text labels used to tell. An unrecorded year falls through to
  // getGradeColor's neutral grey default.
  const gc = getGradeColor(years[selectedYear]?.iptr.grade_level ?? '');
  // Age AS OF THE SELECTED SCHOOL YEAR, not today (Sprint 57b). Deriving age
  // from `birthday` does not make it safe — deriving it TO TODAY is the
  // staleness: viewing a 2025-2026 record showed the age the pupil is now, and
  // on a DOH form age at examination is clinical data. Anchored to that year's
  // charting date when one exists, otherwise to the start of that school year.
  const computeAge = (birthday: string, on: Date) => {
    if (!birthday) return 0;
    const birth = new Date(birthday);
    if (Number.isNaN(birth.getTime())) return 0;
    let age = on.getFullYear() - birth.getFullYear();
    const m = on.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && on.getDate() < birth.getDate())) age--;
    return age;
  };

  /** June 1 of a "YYYY-YYYY" school year. */
  const schoolYearAnchor = (sy: string | undefined): Date | null => {
    const first = Number(String(sy ?? '').split('-')[0]);
    return Number.isFinite(first) && first > 0 ? new Date(first, 5, 1) : null;
  };

  const handleToothClick = (toothNumber: number) => {
    const isTemp = temporaryTeeth.has(toothNumber);
    if (selectedCondition) {
      const codeObj = conditionCodes.find((c) => c.code === selectedCondition);
      const code = codeObj ? (isTemp ? codeObj.temp : codeObj.perm) : selectedCondition;
      const current = currentChart[toothNumber]?.condition;
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: current === code ? '' : code, treatment: prev[toothNumber]?.treatment || '' },
      }));
    } else if (selectedTreatment) {
      const current = currentChart[toothNumber]?.treatment;
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: prev[toothNumber]?.condition || '', treatment: current === selectedTreatment ? '' : selectedTreatment },
      }));
    } else {
      // No code selected: clicking a tooth empties it. This used to be a dead
      // click, which meant the ONLY way to remove a code was to first hunt down
      // the matching code in the palette and click the tooth again — you had to
      // know what was already there to get rid of it.
      //
      // Clears BOTH condition and treatment on purpose: with neither brush
      // active the intent is "empty this tooth". Removing just one is still
      // possible the precise way — select that exact code and click to toggle
      // it off. Nothing persists until Save Chart, and Cancel Edit discards it.
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: '', treatment: '' },
      }));
    }
  };

  useEffect(() => {
    const measureStickyOffsets = () => {
      const headerHeight = headerRowRef.current?.offsetHeight ?? 0;
      const tabsHeight = tabsRowRef.current?.offsetHeight ?? 0;
      setStickyOffsets({ tabsTop: headerHeight, yearTop: headerHeight + tabsHeight });
    };
    measureStickyOffsets();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measureStickyOffsets);
      if (headerRowRef.current) resizeObserver.observe(headerRowRef.current);
      if (tabsRowRef.current) resizeObserver.observe(tabsRowRef.current);
    }
    window.addEventListener('resize', measureStickyOffsets);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureStickyOffsets);
    };
  }, [activeTab, years.length, editingInfo, saved]);

  const getNextSchoolYear = () => {
    if (years.length === 0) return ALL_SCHOOL_YEARS[0];
    const lastYear = years[years.length - 1].iptr.school_year;
    const lastYearIndex = ALL_SCHOOL_YEARS.indexOf(lastYear);
    return lastYearIndex >= 0 ? ALL_SCHOOL_YEARS[lastYearIndex + 1] ?? null : null;
  };

  // `addingYear` closes the double-submit that put two 2026-2027 records on one
  // student a second apart. The API rejects the duplicate too (uniqueBy on
  // student_id + school_year); this stops the second request being sent at all.
  const [addingYear, setAddingYear] = useState(false);

  const handleAddYear = async () => {
    const nextYear = getNextSchoolYear();
    if (!nextYear || !id || addingYear) return;
    setAddingYear(true);
    try {
      // Stamp the grade and section the student is in AS OF THIS YEAR'S
      // record. This is the whole point of Sprint 57a: next year's IPTR gets
      // next year's grade, and this year's stops being rewritten when the
      // student is promoted.
      await apiClient.post('/student-iptrs', {
        student_id: id,
        school_year: nextYear,
        grade_level: student?.grade_level ?? null,
        section: student?.section ?? null,
      });
      await reload();
      toast.success(`School year ${nextYear} added.`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to add school year');
    } finally {
      setAddingYear(false);
    }
  };

  const [confirmDeleteYear, setConfirmDeleteYear] = useState<number | null>(null);
  const [deletingYear, setDeletingYear] = useState(false);

  const handleDeleteYear = async (yearIndex: number) => {
    if (!canEdit || years.length <= 1) return;
    const iptrId = years[yearIndex]?.iptr._id;
    if (!iptrId) return;
    try {
      await apiClient.patch(`/student-iptrs/${iptrId}/archive`);
      setSelectedYear((prev) => (prev === yearIndex ? Math.max(0, yearIndex - 1) : prev > yearIndex ? prev - 1 : prev));
      await reload();
      toast.success('School year removed.');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to remove school year');
    }
  };
  const confirmDeleteYearNow = async () => {
    if (confirmDeleteYear === null) return;
    setDeletingYear(true);
    try {
      await handleDeleteYear(confirmDeleteYear);
      setConfirmDeleteYear(null);
    } finally {
      setDeletingYear(false);
    }
  };

  useEffect(() => {
    if (!canEdit) setIsManagingYears(false);
  }, [canEdit]);

  // Persists the current year's chart + medical/diet/oral history for real.
  const handleSave = async () => {
    if (!currentYearData || !id) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Teeth are dentist-only (aides save History & Oral); the chart record
      // is only created when there are real tooth changes to persist — an
      // aide saving history must not require (or fabricate) a dentist chart.
      const existingByTooth = new Map(currentYearData.toothRecords.map((tr) => [tr.tooth_number, tr]));
      const pendingTeeth = canEdit
        ? Object.entries(draftChart)
            // ToothRecord.condition is required (non-empty) on the backend --
            // a tooth toggled back to "cleared" (empty string) has nothing
            // valid to persist. Its local draft state just won't be sent; on
            // reload it reverts to its last real saved value, if any, rather
            // than crashing the save with a validation error.
            .filter(([, entry]) => entry.condition !== '')
            .filter(([toothStr, entry]) => {
              const existing = existingByTooth.get(Number(toothStr));
              return !existing || existing.condition !== entry.condition || (existing.treatment_code ?? '') !== entry.treatment;
            })
        : [];

      let chartId = currentYearData.dentalChart?._id;
      if (!chartId && pendingTeeth.length > 0) {
        if (!currentDentist) throw new Error('No dentist record linked to your account.');
        const created = await apiClient.post<{ _id: string }>('/dental-charts', {
          iptr_id: currentYearData.iptr._id,
          dentist_id: currentDentist._id,
          date_charted: toLocalDateString(new Date()),
        });
        chartId = created._id;
      }

      const toothWrites = pendingTeeth.map(([toothStr, entry]) => {
        const toothNumber = Number(toothStr);
        const existing = existingByTooth.get(toothNumber);
        const body = { chart_id: chartId, tooth_number: toothNumber, condition: entry.condition, treatment_code: entry.treatment };
        return existing ? apiClient.put(`/tooth-records/${existing._id}`, body) : apiClient.post('/tooth-records', body);
      });

      const medBody = {
        iptr_id: currentYearData.iptr._id,
        allergies: draftMed.allergies, hypertension: draftMed.hypertension, diabetes_mellitus: draftMed.diabetes,
        cardiovascular_disease: draftMed.cardiovascular, thyroid_disorders: draftMed.thyroid,
        hepatitis_disorders: draftMed.hepatitis, malignancy: draftMed.malignancy,
        previous_hospitalization: draftMed.hospitalization, previous_surgical: false,
        blood_transfusion: draftMed.bloodTransfusion, tattoo: draftMed.tattoo, others: draftMed.others,
      };
      const medWrite = currentYearData.medicalHistory
        ? apiClient.put(`/medical-histories/${currentYearData.medicalHistory._id}`, medBody)
        : apiClient.post('/medical-histories', medBody);

      const dietBody = {
        iptr_id: currentYearData.iptr._id, sugar_beverages: draftDiet.sugarSweetened, alcohol_drinker: draftDiet.alcoholDrinker,
        tobacco_user: draftDiet.tobaccoUser, betel_nut_chewer: draftDiet.betelNut, body_piercing: draftDiet.bodyPiercing,
        nail_biting: draftDiet.nailBiting, thumb_sucking: draftDiet.thumbsucking,
      };
      const dietWrite = currentYearData.dietaryHabits
        ? apiClient.put(`/dietary-social-habits/${currentYearData.dietaryHabits._id}`, dietBody)
        : apiClient.post('/dietary-social-habits', dietBody);

      const oralBody = {
        iptr_id: currentYearData.iptr._id, oral_hygiene: draftOral.oralHygiene || 'Not assessed', gingivitis: draftOral.gingivitis,
        periodontal_disease: draftOral.periodontal, debris: draftOral.debris, calculus: draftOral.calculus,
        abnormal_growth: draftOral.abnormalGrowth, cleft_lip_palate: draftOral.cleftLipPalate, others: draftOral.others,
      };
      const oralWrite = currentYearData.oralCondition
        ? apiClient.put(`/oral-health-conditions/${currentYearData.oralCondition._id}`, oralBody)
        : apiClient.post('/oral-health-conditions', oralBody);

      await Promise.all([...toothWrites, medWrite, dietWrite, oralWrite]);
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // The "Saved!" button label is an in-place echo for whoever is still
      // looking at the button — but it sits at the top of a long scrolling
      // form, so someone who edited teeth further down never sees it. The
      // toast is what actually confirms the save. One message, not four:
      // the writes above are a single user action, not four separate ones.
      toast.success('Chart saved.');
      if (iptrContext === 'dental-queue') setTimeout(() => navigate('/ai-analytics'), 450);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save';
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key ?? 'history');
    }
  }, [activeTab, visibleTabs]);

  // Marking consent complete is one-way — there is no unchecking it back to
  // pending once confirmed (see the Consent tab checkbox, which is disabled
  // the moment it's complete). So this only ever moves pending → complete,
  // gated behind a confirmation dialog warning exactly that.
  const [confirmConsentTarget, setConfirmConsentTarget] = useState<{ iptrId: string; schoolYear: string } | null>(null);

  // Takes an explicit iptrId rather than reading `years[selectedYear]` — the
  // Consent tab shows every year's own container at once (each renewed
  // separately, see StudentIptr.ts), so a toggle must name which year's
  // record it is updating instead of assuming "whichever year is selected".
  const handleToggleConsent = async (iptrId: string, checked: boolean) => {
    if (!canEdit) return;
    try {
      await apiClient.put(`/student-iptrs/${iptrId}`, { consent_status: checked ? 'complete' : 'pending' });
      await reload();
      toast.success(checked ? 'Consent marked complete.' : 'Consent marked pending.');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to update consent status');
    }
  };

  const openEditInfo = () => {
    if (!student) return;
    setDraftInfo({ ...student });
    const iptr = years[selectedYear]?.iptr;
    setDraftYear({
      height_cm: iptr?.height_cm != null ? String(iptr.height_cm) : '',
      weight_kg: iptr?.weight_kg != null ? String(iptr.weight_kg) : '',
      // Deliberately NOT falling back to the student's current grade. A blank
      // means "never recorded for this year", and pre-filling today's grade
      // would let one careless Save stamp it onto an old year — the exact lie
      // Sprint 57a removed.
      grade_level: iptr?.grade_level ?? '',
      section: iptr?.section ?? '',
    });
    setInfoError(null);
    setEditingInfo(true);
  };

  const handleSaveInfo = async () => {
    if (!id || !draftInfo) return;
    setInfoSaving(true);
    setInfoError(null);
    try {
      await apiClient.put(`/students/${id}`, draftInfo);
      // Two writes because the panel edits two records. Blank clears the
      // measurement rather than storing 0, which would read as "measured at
      // zero" and feed a nonsense BMI.
      const iptrId = years[selectedYear]?.iptr._id;
      if (iptrId) {
        await apiClient.put(`/student-iptrs/${iptrId}`, {
          height_cm: draftYear.height_cm.trim() === '' ? null : Number(draftYear.height_cm),
          weight_kg: draftYear.weight_kg.trim() === '' ? null : Number(draftYear.weight_kg),
          // Editable so a RETAINED pupil, or a section moved mid-year, can be
          // corrected on the year it belongs to — the dentist's own example.
          // Blank clears back to "not recorded" rather than writing "".
          grade_level: draftYear.grade_level.trim() === '' ? null : draftYear.grade_level,
          section: draftYear.section.trim() === '' ? null : draftYear.section,
        });
      }
      await reload();
      toast.success('Student info updated.');
      setEditingInfo(false);
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : 'Failed to update student info');
    } finally {
      setInfoSaving(false);
    }
  };

  const ToothButton = ({ num }: { num: number }) => {
    const data = currentChart[num];
    const cond = data?.condition || '';
    const treat = data?.treatment || '';
    const colorClass = conditionColors[cond] || conditionColors[cond.toLowerCase()] || 'bg-card border-border';
    const isSelected = editingChart && (selectedCondition || selectedTreatment);
    const hoverClass = isSelected
      ? 'hover:border-teal-500 hover:ring-2 hover:ring-teal-300 hover:bg-teal-50 cursor-pointer'
      : 'cursor-default';
    return (
      <button
        onClick={() => editingChart && handleToothClick(num)}
        // Grows to fill the card instead of leaving ~100px of slack on each
        // side, capped so the boxes stay tooth-shaped rather than becoming wide
        // rectangles on a large screen. flex-1 is also what keeps the primary
        // row aligned with the permanent one -- both rows are 16 equal slots.
        className={`relative flex h-[52px] min-w-[40px] max-w-[56px] flex-1 flex-col items-center justify-between rounded-md border-2 px-0.5 py-1 text-center transition-all md:h-[64px] ${colorClass} ${hoverClass}`}
      >
        <div className="text-[8px] font-medium text-slate-500 leading-none">{num}</div>
        {cond && <div className="text-[11px] md:text-sm font-bold text-slate-700 leading-none">{cond}</div>}
        {/* Blue, not teal: the palette selects conditions in teal and
            treatments in blue, but this rendered the treatment code in the
            condition colour, crossing the two vocabularies on the teeth. */}
        {treat && <div className="text-[8px] md:text-[10px] font-semibold text-blue-700 leading-none">{treat}</div>}
      </button>
    );
  };

  // A primary arch holds 10 teeth against the permanent arch's 16. The three
  // missing positions at each end are the molars that have no primary
  // predecessor (18/17/16 and 26/27/28), so blank slots there put every
  // primary tooth under its successor. Same flex sizing as ToothButton, so the
  // columns cannot drift apart.
  const padToArch = (teeth: number[]) => [
    ...Array.from({ length: 3 }, (_, i) => <div key={`pad-l${i}`} aria-hidden className="min-w-[40px] max-w-[56px] flex-1" />),
    ...teeth.map((n) => <ToothButton key={n} num={n} />),
    ...Array.from({ length: 3 }, (_, i) => <div key={`pad-r${i}`} aria-hidden className="min-w-[40px] max-w-[56px] flex-1" />),
  ];

  const chartedConditionCount = Object.values(currentChart).filter((e) => e.condition).length;
  const chartedTreatmentCount = Object.values(currentChart).filter((e) => e.treatment).length;

  // Clears one vocabulary across every tooth, leaving the other untouched.
  // Draft-only: nothing reaches the DB until Save, so Cancel still undoes it.
  const clearAll = (field: 'condition' | 'treatment') => {
    setDraftChart((prev) => {
      const next: Record<number, ChartEntry> = {};
      Object.entries(prev).forEach(([tooth, entry]) => {
        next[Number(tooth)] = { ...entry, [field]: '' };
      });
      return next;
    });
    setConfirmClear(null);
  };

  const treatmentCodeCounts = treatmentCodes.reduce<Record<string, number>>((acc, code) => {
    acc[code.code] = Object.values(currentChart).filter((entry) => entry.treatment === code.code).length;
    return acc;
  }, {});

  // Treatment History tab -- combined across all school years, most recent first.
  const allTreatments = useMemo(
    () => years.flatMap((y) => y.treatments).sort((a, b) => b.date.localeCompare(a.date)),
    [years],
  );
  const dentistNameById = useMemo(() => new Map(dentists.map((d) => [d._id, `Dr. ${d.first_name} ${d.last_name}`])), [dentists]);

  const [showAddTreatment, setShowAddTreatment] = useState(false);
  const [treatmentForm, setTreatmentForm] = useState({ date: toLocalDateString(new Date()), diagnosis: '', treatmentDone: '', remarks: '' });
  const [treatmentSaving, setTreatmentSaving] = useState(false);
  const [treatmentError, setTreatmentError] = useState<string | null>(null);

  const handleAddTreatment = async () => {
    if (!currentYearData || !currentDentist) {
      setTreatmentError('No dentist record linked to your account.');
      return;
    }
    if (!treatmentForm.diagnosis || !treatmentForm.treatmentDone) {
      setTreatmentError('Diagnosis and treatment done are required.');
      return;
    }
    setTreatmentSaving(true);
    setTreatmentError(null);
    try {
      await apiClient.post('/treatments', {
        iptr_id: currentYearData.iptr._id,
        dentist_id: currentDentist._id,
        diagnosis: treatmentForm.diagnosis,
        treatment_done: treatmentForm.treatmentDone,
        remarks: treatmentForm.remarks,
        date: treatmentForm.date,
      });
      await reload();
      toast.success('Treatment entry saved.');
      setTreatmentForm({ date: toLocalDateString(new Date()), diagnosis: '', treatmentDone: '', remarks: '' });
      setShowAddTreatment(false);
    } catch (err) {
      setTreatmentError(err instanceof ApiError ? err.message : 'Failed to save treatment entry');
    } finally {
      setTreatmentSaving(false);
    }
  };

  const showStickyYearBar = activeTab === 'history' || activeTab === 'chart';
  const backPath = iptrContext === 'risk' ? '/ai-analytics' : iptrContext === 'treatment' ? '/treatment-records' : '/dental-charts';

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }
  if (error || !student) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <p className="text-destructive">{error ?? 'Student not found.'}</p>
        <Link to="/dental-charts" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← Back to Dental Charts</Link>
      </div>
    );
  }

  const ageAnchor =
    (years[selectedYear]?.dentalChart?.date_charted ? new Date(years[selectedYear].dentalChart.date_charted) : null)
    ?? schoolYearAnchor(years[selectedYear]?.iptr.school_year)
    ?? new Date();
  const patientAge = computeAge(student.birthday, ageAnchor);

  // Grade and section AS OF THE SELECTED SCHOOL YEAR (Sprint 57a). These used
  // to read `student.grade_level`, which is a single current value — so opening
  // a Grade 5 student's 2025-2026 record showed Grade 5, not the Grade 3 they
  // actually were, and it silently rewrote itself every time the child was
  // promoted.
  //
  // Records created before this sprint carry null, and there is deliberately NO
  // fallback to the student's current grade: that fallback IS the bug. They
  // render as "not recorded", which is honest about what the system knows.
  const yearIptr = years[selectedYear]?.iptr;
  const yearGrade = yearIptr?.grade_level ?? null;
  const yearSection = yearIptr?.section ?? null;
  // Same per-year rule as grade above: consent is obtained for this school
  // year's IPTR, never inherited from another year.
  const consentComplete = yearIptr?.consent_status === 'complete';

  // The patient's own record as a PDF — Sprint 52 named this "the one export a
  // clinic actually needs (a patient's own record for their file)" and left it
  // unbuilt. Captures the record body, not the sticky toolbar.
  const onIptrPdf = async () => {
    if (!recordRef.current) return;
    setPdfBusy(true);
    try {
      const who = surnameFirst(student).replace(/[^\w]+/g, '-');
      await exportDohReportToPdf(recordRef.current, `IPTR_${who}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  // Capped at 5xl used to leave large idle gutters on laptop/desktop widths
  // where every other page in the app runs full-width — widened to 80% of
  // the available content area on large screens; phones/tablets stay full
  // width since 80% of a narrow viewport would just add dead margins there
  // instead of removing them.
  return (
    <div className="space-y-4 w-full lg:max-w-[80%] mx-auto">
      {/* Sticky header row */}
      <div ref={headerRowRef} className="sticky top-0 z-40 bg-gray-50 pb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={backPath} className="p-2 hover:bg-gray-100 rounded-lg shrink-0">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-primary">Individual Patient Treatment Record</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* PDF ONLY — no Excel, deliberately. This is one patient's own
              record, the document a family or a referral needs; a spreadsheet
              of a single patient serves nobody and would be a decrypted PII
              file with no filing purpose. Sprint 52 removed the bulk patient
              exports for exactly that reason and named THIS as the one export
              a clinic actually needs. */}
          <button
            onClick={onIptrPdf}
            disabled={pdfBusy}
            title="Download this patient's record as a PDF"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />{pdfBusy ? 'Preparing…' : 'PDF'}
          </button>
          <div className="hidden sm:flex items-center gap-1 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => prevPatient && navigate(`/dental-chart/${prevPatient.id}`)}
              disabled={!prevPatient}
              title={prevPatient ? `← ${prevPatient.name}` : undefined}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default border-r border-border"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {/* Surname, not the given name: the list is ordered by surname,
                  so the button must name the same thing you are stepping through. */}
              {prevPatient ? <span className="max-w-[80px] truncate">{prevPatient.lastName || prevPatient.name}</span> : 'First'}
            </button>
            <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground">
              <Users className="w-3 h-3" />
              {navIndex >= 0 ? `${navIndex + 1}/${navList.length}` : '—'}
            </span>
            <button
              onClick={() => nextPatient && navigate(`/dental-chart/${nextPatient.id}`)}
              disabled={!nextPatient}
              title={nextPatient ? `${nextPatient.name} →` : undefined}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default border-l border-border"
            >
              {nextPatient ? <span className="max-w-[80px] truncate">{nextPatient.lastName || nextPatient.name}</span> : 'Last'}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Everything below the sticky toolbar is the record itself, and is what
          the PDF captures. */}
      <div ref={recordRef} className="space-y-4">
      {/* Patient Info Card */}
      <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div style={{ backgroundColor: gc.light, color: gc.solid }} className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl flex-shrink-0">
                  {[student.first_name?.[0], student.last_name?.[0]].filter(Boolean).join('') || student.full_name?.[0]}
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">{surnameFirstWithInitial(student)}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {yearGrade && <GradePill grade={yearGrade} />}
                    {yearSection && <span style={{ color: gc.solid }} className="text-xs font-medium">{yearSection}</span>}
                    {student.is_4ps && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">4Ps</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Read-only here on purpose — consent has its own tab and its
                    own toggle. Editing student info must never touch it. */}
                <span
                  title={`${consentComplete ? 'Consent obtained' : 'Consent pending'} for ${yearIptr?.school_year ?? 'this year'}`}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${consentComplete ? 'bg-success-surface text-success' : 'bg-warning-surface text-warning'}`}
                >
                  {consentComplete ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  {consentComplete ? 'Consent Complete' : 'Consent Pending'}
                </span>
                {canEditInfo && (
                  <button onClick={openEditInfo} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-gray-50">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-sm border-t border-border pt-4">
              {[
                ['Birthday', formatDate(student.birthday)],
                ['Age', `${patientAge} years`],
                ['Sex', student.sex],
                ['Contact', student.contact_number || '—'],
                ['Address', student.address],
                ['PhilHealth', `${student.philhealth_number || '—'} (${student.philhealth_status || 'None'})`],
                ['Guardian', student.guardian_name || '—'],
                ['Guardian Contact', student.guardian_contact || '—'],
                // Year-scoped, like grade and age above — these belong to the
                // selected school year's record, not to the student.
                ['Height', yearIptr?.height_cm != null ? `${yearIptr.height_cm} cm` : 'not measured'],
                ['Weight', yearIptr?.weight_kg != null ? `${yearIptr.weight_kg} kg` : 'not measured'],
                ['BMI', computeBmi(yearIptr?.height_cm, yearIptr?.weight_kg) ?? 'not measured'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-xs text-muted-foreground font-medium mb-0.5">{label}</div>
                  <div className="text-foreground font-medium" title={label === 'BMI' ? BMI_NOTE : undefined}>{val}</div>
                </div>
              ))}
            </div>
      </div>

      {/* Edit Student Information — mirrors Add Student's modal chrome and
          field styling (PatientList.tsx) so editing feels like the same form,
          not a cramped second UI. */}
      {editingInfo && (
        <Modal onClose={() => setEditingInfo(false)} maxWidth="max-w-4xl" closeDisabled={infoSaving}>
          <div className="flex items-start justify-between gap-3 p-6 border-b">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Basic Information
              </div>
              <h2 className="text-lg font-bold text-foreground">Update Student Information</h2>
            </div>
            <button onClick={() => setEditingInfo(false)} className="text-muted-foreground hover:text-muted-foreground"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            {infoError && <p className="text-xs text-destructive">{infoError}</p>}
            {/* Three boxes, matching the DOH IPTR paper form. full_name is
                derived server-side from these, so it is not edited directly. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Last Name<span className="text-destructive"> *</span></label>
                <input type="text" value={draftInfo.last_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, last_name: e.target.value.toUpperCase() }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">First Name<span className="text-destructive"> *</span></label>
                <input type="text" value={draftInfo.first_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, first_name: e.target.value.toUpperCase() }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Middle Name</label>
                <input type="text" value={draftInfo.middle_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, middle_name: e.target.value.toUpperCase() }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Birthday<span className="text-destructive"> *</span></label>
                <input type="date" value={draftInfo.birthday?.slice(0, 10) ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, birthday: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Sex<span className="text-destructive"> *</span></label>
              <div className="grid grid-cols-2 gap-2">
                {(['Male', 'Female'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDraftInfo((p) => ({ ...p, sex: g }))}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      draftInfo.sex === g ? 'bg-primary text-white border-primary' : 'border-border text-foreground hover:bg-canvas'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            {/* ── Current enrolment ── read by rosters and the appointment
                picker; required, same as Add Student's Grade/Section. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Grade <span className="font-normal">· current</span><span className="text-destructive"> *</span>
                </label>
                <select value={draftInfo.grade_level ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, grade_level: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Section <span className="font-normal">· current</span><span className="text-destructive"> *</span>
                </label>
                <input type="text" value={draftInfo.section ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, section: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            {/* ── This school year's record ──────────────────────────────
                Everything from here down saves to the SELECTED YEAR's IPTR,
                not to the student. Two grades exist on purpose: the student
                carries their CURRENT enrolment (above), and each year carries
                the grade the pupil was actually in then (Sprint 57a). They
                differ for a retained pupil, and for every past year once
                anyone is promoted — which is the whole reason the year keeps
                its own. Optional here: no truthful value to require for a
                year created before this existed. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Grade <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span><span className="text-muted-foreground font-normal"> (Optional)</span>
                </label>
                <select value={draftYear.grade_level}
                  onChange={(e) => setDraftYear((p) => ({ ...p, grade_level: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                  <option value="">Not recorded</option>
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Section <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span><span className="text-muted-foreground font-normal"> (Optional)</span>
                </label>
                <input type="text" placeholder="Not recorded" value={draftYear.section}
                  onChange={(e) => setDraftYear((p) => ({ ...p, section: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            {/* Measured per school year, saved to the IPTR. */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Height (cm) <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span>
                </label>
                <input type="number" min="0" max="300" step="0.1" inputMode="decimal"
                  value={draftYear.height_cm}
                  onChange={(e) => setDraftYear((p) => ({ ...p, height_cm: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Weight (kg) <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span>
                </label>
                <input type="number" min="0" max="500" step="0.1" inputMode="decimal"
                  value={draftYear.weight_kg}
                  onChange={(e) => setDraftYear((p) => ({ ...p, weight_kg: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">BMI</label>
                <div className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground" title={BMI_NOTE}>
                  {computeBmi(Number(draftYear.height_cm) || null, Number(draftYear.weight_kg) || null) ?? 'enter both'}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact Number<span className="text-muted-foreground font-normal"> (Optional)</span></label>
                <input type="text" value={draftInfo.contact_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, contact_number: e.target.value }))}
                  placeholder="09XX-XXX-XXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Guardian Contact<span className="text-muted-foreground font-normal"> (Optional)</span></label>
                <input type="text" value={draftInfo.guardian_contact ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_contact: e.target.value }))}
                  placeholder="09XX-XXX-XXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Guardian Name<span className="text-muted-foreground font-normal"> (Optional)</span></label>
              <input type="text" value={draftInfo.guardian_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_name: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">PhilHealth Number<span className="text-muted-foreground font-normal"> (Optional)</span></label>
                <input type="text" value={draftInfo.philhealth_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_number: e.target.value }))}
                  placeholder="XX-XXXXXXXXX-X" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">PhilHealth Status</label>
                <select value={draftInfo.philhealth_status ?? 'None'} onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_status: e.target.value as 'None' | 'Principal' | 'Dependent' }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-card">
                  <option>Dependent</option><option>Principal</option><option>None</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">School</label>
              <select value={schoolName} disabled className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-muted text-muted-foreground">
                {schoolNames.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Address<span className="text-muted-foreground font-normal"> (Optional)</span></label>
              <input type="text" value={draftInfo.address ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, address: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="edit-4ps" checked={!!draftInfo.is_4ps} onChange={(e) => setDraftInfo((p) => ({ ...p, is_4ps: e.target.checked }))}
                className="w-4 h-4 rounded accent-primary" />
              <label htmlFor="edit-4ps" className="text-sm font-medium text-foreground">4Ps / NHTS Member</label>
            </div>
          </div>
          <div className="flex gap-3 p-6 border-t">
            <button onClick={() => setEditingInfo(false)} className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>
            <button onClick={handleSaveInfo} disabled={infoSaving} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">{infoSaving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {/* Tabs */}
      <div className="sticky z-30 bg-gray-50 space-y-0" style={{ top: stickyOffsets.tabsTop }}>
        <div className="bg-card rounded-xl border border-border">
          <div ref={tabsRowRef} className="rounded-t-xl border-b border-border bg-card">
            <div className="flex items-center">
              <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="flex min-w-max">
              {visibleTabs.map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key as TabKey)}
                  className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors ${activeTab === tab.key ? 'border-b-2 border-blue-700 text-blue-700 bg-blue-50' : 'text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                  {tab.label}
                </button>
              ))}
              </div>
              </div>
              {canEditHistory && currentYearData && (editMode || activeTab === 'history' || (canEdit && activeTab === 'chart')) && (
                <div className="flex shrink-0 items-center gap-2 px-3">
                  {!editMode ? (
                    <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                      <Pencil className="w-3 h-3" />
                      {canEdit ? 'Edit Chart' : 'Edit History & Oral'}
                    </button>
                  ) : (
                    <>
                      <button onClick={cancelEdit} disabled={saving} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60">
                        Cancel
                      </button>
                      <button onClick={handleSave} disabled={saving} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${saved ? 'bg-green-600 text-white' : 'bg-primary text-white hover:bg-primary-hover'}`}>
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {saveError && <p className="px-4 pb-2 text-xs text-destructive">{saveError}</p>}
          </div>
          {showStickyYearBar && years.length > 0 && (
            <div className="border-t border-gray-100 bg-card px-4 pt-3">
              <div className="overflow-x-auto">
              <div className="flex items-center gap-0 min-w-max">
              {years.map((y, idx) => {
                const yrChart: Record<number, ChartEntry> = {};
                for (const tr of y.toothRecords) yrChart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
                const yrDmft = computeDMFT(yrChart);
                const isActive = selectedYear === idx;
                return (
                  <div key={y.iptr._id} className={`mr-1 flex flex-shrink-0 items-stretch border-b-2 ${isActive ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                    <button type="button" onClick={() => setSelectedYear(idx)} className="px-4 py-2.5 text-left text-xs font-medium transition-all">
                      <div>{y.iptr.school_year}</div>
                      {activeTab === 'chart' && (
                        <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'}>DMFT: {yrDmft.T + yrDmft.t}</div>
                      )}
                      <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'}>
                        {formatDateStamp(y.dentalChart?.date_charted)}
                      </div>
                    </button>
                    {canEdit && isManagingYears && years.length > 1 && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteYear(idx); }} className="border-l border-border px-2 text-muted-foreground transition-colors hover:bg-card hover:text-destructive" title={`Remove ${y.iptr.school_year}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {canEdit && (
                <div className="ml-2 flex flex-shrink-0 items-center gap-2 py-2">
                  <button type="button" onClick={() => setIsManagingYears((prev) => !prev)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${isManagingYears ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'border border-border bg-card text-muted-foreground hover:bg-gray-50'}`}>
                    {isManagingYears ? 'Done' : 'Edit Years'}
                  </button>
                  {isManagingYears && !!getNextSchoolYear() && (
                    <button type="button" onClick={handleAddYear} disabled={addingYear} className="flex-shrink-0 px-3 py-2 text-xs text-muted-foreground hover:text-blue-600 border-b-2 border-transparent hover:border-blue-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                      + Add Year
                    </button>
                  )}
                </div>
              )}
              </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-card rounded-xl border border-border">

        {years.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-sm">No IPTR school-year records yet for this student.</p>
            {canEdit && <button onClick={handleAddYear} disabled={addingYear} className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed">+ Start {getNextSchoolYear()}</button>}
          </div>
        ) : (
        <>
        {/* ── TAB 1: History ── */}
        {activeTab === 'history' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">Medical History</div>
                <div className="space-y-1.5">
                  {([
                    ['Hypertension / CVA', 'hypertension'], ['Diabetes Mellitus', 'diabetes'],
                    ['Cardiovascular / Heart Diseases', 'cardiovascular'], ['Thyroid Disorders', 'thyroid'],
                    ['Hepatitis', 'hepatitis'], ['Malignancy', 'malignancy'],
                    ['History of Hospitalization', 'hospitalization'], ['Blood Transfusion', 'bloodTransfusion'], ['Tattoo', 'tattoo'],
                  ] as [string, keyof MedicalHistoryDraft][]).map(([label, field]) => (
                    <label key={field} className="flex items-center justify-between text-xs text-foreground py-1 border-b border-gray-100 last:border-0">
                      {label}
                      <input type="checkbox" disabled={!editingHistory} checked={!!draftMed[field]}
                        onChange={(e) => setDraftMed((p) => ({ ...p, [field]: e.target.checked }))}
                        className="w-4 h-4 rounded accent-teal-600 disabled:cursor-not-allowed" />
                    </label>
                  ))}
                  <div className="pt-1">
                    <label className="block text-xs text-muted-foreground mb-1">Allergies</label>
                    <input type="text" disabled={!editingHistory} value={draftMed.allergies} onChange={(e) => setDraftMed((p) => ({ ...p, allergies: e.target.value }))}
                      placeholder="—" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">Dietary Habits and Social History</div>
                <div className="space-y-1.5">
                  {([
                    ['Sugar Sweetened Beverages/Food', 'sugarSweetened'], ['Alcohol Drinker', 'alcoholDrinker'],
                    ['Tobacco User', 'tobaccoUser'], ['Betel Nut Chewer', 'betelNut'],
                    ['Body Piercing', 'bodyPiercing'], ['Nail Biting', 'nailBiting'], ['Thumbsucking', 'thumbsucking'],
                  ] as [string, keyof DietDraft][]).map(([label, field]) => (
                    <label key={field} className="flex items-center justify-between text-xs text-foreground py-1 border-b border-gray-100 last:border-0">
                      {label}
                      <input type="checkbox" disabled={!editingHistory} checked={!!draftDiet[field]}
                        onChange={(e) => setDraftDiet((p) => ({ ...p, [field]: e.target.checked }))}
                        className="w-4 h-4 rounded accent-teal-600 disabled:cursor-not-allowed" />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">
                Oral Health Condition
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                {([
                  ['Gingivitis', 'gingivitis'], ['Periodontal Disease', 'periodontal'], ['Debris', 'debris'],
                  ['Calculus', 'calculus'], ['Abnormal Growth', 'abnormalGrowth'], ['Cleft Lip / Palate', 'cleftLipPalate'],
                ] as [string, keyof OralDraft][]).map(([label, field]) => (
                  <label key={field} className="flex items-center justify-between text-xs text-foreground py-1 border-b border-gray-100">
                    {label}
                    <input type="checkbox" disabled={!editingHistory} checked={!!draftOral[field]}
                      onChange={(e) => setDraftOral((p) => ({ ...p, [field]: e.target.checked }))}
                      className="w-4 h-4 rounded accent-teal-600 disabled:cursor-not-allowed" />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Oral Hygiene</label>
                  <input type="text" disabled={!editingHistory} value={draftOral.oralHygiene} onChange={(e) => setDraftOral((p) => ({ ...p, oralHygiene: e.target.value }))}
                    placeholder="e.g. Good, Fair, Poor" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Others</label>
                  <input type="text" disabled={!editingHistory} value={draftOral.others} onChange={(e) => setDraftOral((p) => ({ ...p, others: e.target.value }))}
                    placeholder="—" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: Dental Chart ── */}
        {activeTab === 'chart' && (
          <div className="p-0 space-y-0">
            <div className="p-4 space-y-4">
            <div className={`bg-blue-50 rounded-xl p-4 ${!editingChart ? 'opacity-50 pointer-events-none select-none' : ''}`}>
              {!canEdit && <p className="text-xs text-muted-foreground mb-2 italic">View only — editing restricted to Dentist</p>}
              {canEdit && !editMode && <p className="text-xs text-muted-foreground mb-2 italic">View mode — click "Edit Chart" to record conditions/treatments</p>}
              <div className={`grid grid-cols-1 ${iptrContext === 'default' ? 'lg:grid-cols-2' : ''} gap-4`}>
                {iptrContext !== 'treatment' && (
                // Symmetric padding with the treatment column so the two grids
                // get identical width -- the divider's padding on one side only
                // made its buttons 3px smaller than its neighbour's.
                <div className={iptrContext === 'default' ? 'lg:pr-4' : undefined}>
                  <div className="text-sm font-semibold text-foreground mb-2 uppercase tracking-wide">Condition Codes</div>
                  {/* Solo (full-width) flows to more columns so buttons stay the
                      size they are in the paired layout. More columns alone was
                      not enough -- 9 across a full-width card still measured
                      101px against the pair's 89px -- so the buttons also carry
                      a max width. Verified by measurement, not by eye. */}
                  <div className={`grid gap-1.5 justify-items-center ${iptrContext ==='dental-queue' ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-9' : 'grid-cols-4 sm:grid-cols-5'}`}>
                    {conditionCodes.map((c) => (
                      <button key={c.code} onClick={() => { setSelectedCondition(selectedCondition === c.code ? null : c.code); setSelectedTreatment(null); }}
                        className={`aspect-square w-full max-w-[86px] min-h-[54px] rounded-lg border p-1.5 text-center transition-all flex flex-col items-center justify-center gap-1 ${selectedCondition === c.code ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                        <div className="text-[13px] sm:text-[15px] font-bold font-mono leading-none">{c.perm}/{c.temp}</div>
                        <div className="text-[9px] sm:text-[10px] font-medium leading-tight">{c.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                )}
                {iptrContext !== 'dental-queue' && (
                // Conditions and treatments are different vocabularies -- one
                // records what IS, the other what was DONE -- but unselected
                // buttons in both groups look identical, so without a rule the
                // two grids read as one long palette. Divider only when both
                // are on screen: side by side from lg, stacked below it.
                <div className={iptrContext === 'default' ? 'border-t border-border pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-4' : undefined}>
                  <div className="text-sm font-semibold text-foreground mb-2 uppercase tracking-wide">Treatment Codes</div>
                  <div className={`grid gap-1.5 justify-items-center ${iptrContext ==='treatment' ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-9' : 'grid-cols-4 sm:grid-cols-5'}`}>
                    {treatmentCodes.map((t) => (
                      <button key={t.code} onClick={() => { setSelectedTreatment(selectedTreatment === t.code ? null : t.code); setSelectedCondition(null); }}
                        className={`aspect-square w-full max-w-[86px] min-h-[54px] rounded-lg border p-1.5 text-center transition-all flex flex-col items-center justify-center gap-1 ${selectedTreatment === t.code ? 'bg-blue-600 text-white ring-2 ring-blue-300 border-blue-600' : 'bg-card border-border text-foreground hover:border-blue-400'}`}>
                        <span className="text-[13px] sm:text-[15px] font-bold font-mono leading-none">{t.code}</span>
                        <span className="text-[9px] sm:text-[10px] font-medium leading-tight">{t.label}</span>
                        {/* The word the clinic actually says, under the
                            clinical term — the buttons are pressed during an
                            appointment, not read off a form. */}
                        {t.local && <span className="text-[8px] sm:text-[9px] opacity-70 leading-none">{t.local}</span>}
                      </button>
                    ))}
                  </div>
                </div>
                )}
              </div>
              {/* Bulk clear: wiping a mis-charted arch one tooth at a time is
                  32 clicks. Conditions and treatments clear separately so
                  re-charting one vocabulary does not discard the other. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setConfirmClear('condition')}
                  disabled={chartedConditionCount === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-red-400 hover:text-destructive disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All Conditions ({chartedConditionCount})
                </button>
                <button
                  onClick={() => setConfirmClear('treatment')}
                  disabled={chartedTreatmentCount === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:border-red-400 hover:text-destructive disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All Treatments ({chartedTreatmentCount})
                </button>
              </div>
              {(selectedCondition || selectedTreatment) && (
                <div className="mt-3 flex items-center gap-2">
                  {selectedCondition && (() => {
                    const c = conditionCodes.find((x) => x.code === selectedCondition);
                    return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-teal-100 text-teal-800">Applying: {c?.perm}/{c?.temp} — {c?.label} · Click teeth to apply</span>;
                  })()}
                  {selectedTreatment && <span className="text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-800">Applying treatment: {selectedTreatment} · Click teeth to apply</span>}
                  {/* Without this the erase mode is folklore: the palette shows
                      what you are applying, but nothing said what a bare click
                      does when nothing is selected. */}
                  {!selectedCondition && !selectedTreatment && (
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-muted text-foreground">No code selected · Click teeth to clear</span>
                  )}
                  <button onClick={() => { setSelectedCondition(null); setSelectedTreatment(null); }} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border p-4 overflow-x-auto">
              {/* Every row is 16 equal slots, so a primary tooth sits directly
                  under the permanent tooth it will replace: 55↔15, 54↔14 …
                  51↔11, 61↔21 … 65↔25 (FDI). The primary rows previously used
                  `5 teeth + a w-9 midline spacer + 5 teeth`, centred — but the
                  permanent row has no midline gap (11 and 21 are adjacent), so
                  the spacer pushed both halves outward and nothing lined up.
                  Three blank slots at each end replace it, and alignment now
                  holds at any tooth size because both rows flex identically. */}
              <div className="min-w-[680px] space-y-2.5">
                {/* DOH IPTR form order: temporary arches on the outside (rows 1
                    and 4), permanent arches on the inside (rows 2 and 3). */}
                <div className="flex justify-center gap-1">{padToArch(upperTemporary)}</div>
                <div className="flex justify-center gap-1">{upperPermanent.map((n) => <ToothButton key={n} num={n} />)}</div>
                <div className="border-t-2 border-dashed border-border my-2" />
                <div className="flex justify-center gap-1">{lowerPermanent.map((n) => <ToothButton key={n} num={n} />)}</div>
                <div className="flex justify-center gap-1">{padToArch(lowerTemporary)}</div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl border border-border p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">DMFT / dmft Scores (Auto-computed)</div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Primary teeth (dmft+x)</div>
                  <div className="flex gap-2">
                    {[['d', dmft.d], ['m', dmft.m], ['f', dmft.f], ['x', dmft.x], ['dmft', dmft.t]].map(([label, val]) => (
                      <div key={label as string} className={`flex-1 border rounded text-center py-1.5 ${label === 'dmft' ? 'border-blue-400 bg-blue-50' : 'border-border'}`}>
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-sm font-bold font-mono text-foreground">{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Permanent teeth (DMFT+X)</div>
                  <div className="flex gap-2">
                    {[['D', dmft.D], ['M', dmft.M], ['F', dmft.F], ['X', dmft.X], ['DMFT', dmft.T]].map(([label, val]) => (
                      <div key={label as string} className={`flex-1 border rounded text-center py-1.5 ${label === 'DMFT' ? 'border-red-400 bg-red-50' : 'border-border'}`}>
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-sm font-bold font-mono text-foreground">{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl border border-border p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Treatment Code Counter (Auto-computed)</div>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                {treatmentCodes.map((code) => (
                  <div key={code.code} className="rounded border border-border bg-card p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{code.code}</div>
                    <div className="text-sm font-bold text-foreground">{treatmentCodeCounts[code.code]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-semibold text-muted-foreground mb-2 uppercase tracking-wide text-[10px]">Condition Codes</div>
                <div className="space-y-1">
                  {[
                    { codes: '✓/✓', label: 'Sound/Sealed', bg: 'bg-green-50' },
                    { codes: 'D/d', label: 'Decayed', bg: 'bg-red-100' },
                    { codes: 'M/m', label: 'Missing', bg: 'bg-slate-200' },
                    { codes: 'F/f', label: 'Filled', bg: 'bg-blue-100' },
                    { codes: 'X/x', label: 'Indicated for Extraction', bg: 'bg-orange-100' },
                    { codes: 'Un/un', label: 'Unerupted', bg: 'bg-purple-50' },
                    { codes: 'S/s', label: 'Supernumerary Tooth', bg: 'bg-yellow-50' },
                    { codes: 'JC/jc', label: 'Jacket Crown', bg: 'bg-pink-50' },
                    { codes: 'P/p', label: 'Pontic', bg: 'bg-indigo-50' },
                  ].map(({ codes, label, bg }) => (
                    <div key={codes} className="flex items-center gap-2">
                      <span className={`font-mono font-bold text-foreground text-[10px] px-1.5 py-0.5 rounded border border-border w-14 text-center ${bg}`}>{codes}</span>
                      <span className="text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-semibold text-muted-foreground mb-2 uppercase tracking-wide text-[10px]">Treatment Codes</div>
                <div className="space-y-1">
                  {[['FV', 'Fluoride Varnish'], ['PFS', 'Pit and Fissure Sealant'], ['PF', 'Permanent Filling'], ['TF', 'Temporary Filling'], ['X', 'Extraction'], ['SDF', 'Silver Diamine Fluoride']].map(([code, label]) => (
                    <div key={code} className="flex gap-2"><span className="font-mono font-bold text-blue-700 w-10">{code}</span><span className="text-muted-foreground">{label}</span></div>
                  ))}
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* ── TAB: Consent ── */}
        {activeTab === 'appointments' && (
          <div className="p-4 space-y-4">
            {/* Standing policy notice, not tied to any one school year — comes
                first, ahead of the per-year consent containers below. */}
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-blue-900 mb-1">Republic Act No. 10173 — Data Privacy Act of 2012</div>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    Ang impormasyong nakolekta sa form na ito ay gagamitin lamang para sa mga layuning pangkalusugan ng Dental Health Program ng Barangay Tanyag, Lungsod ng Taguig. Ang inyong personal na impormasyon ay protektado ng Batas Republika Blg. 10173 o ang Data Privacy Act ng 2012. Ang inyong datos ay hindi ibabahagi sa anumang partido na walang pahintulot maliban kung kinakailangan ng batas.
                  </p>
                </div>
              </div>
            </div>

            {/* One container per school year, newest first — consent is
                renewed annually (see StudentIptr.ts) and never carries over,
                so a year a student is reassigned into always starts unticked
                again, on purpose, with its own checkbox to confirm. */}
            {years.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">No school year records yet.</p>
            ) : (
              [...years].reverse().map((y) => {
                const complete = y.iptr.consent_status === 'complete';
                const yrGrade = y.iptr.grade_level;
                const yrSection = y.iptr.section;
                return (
                  <div key={y.iptr._id} className={`rounded-xl border p-5 ${complete ? 'bg-success-surface border-green-200' : 'bg-warning-surface border-amber-200'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${complete ? 'bg-white text-success' : 'bg-white text-warning'}`}>
                          {complete ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className={`text-sm font-bold ${complete ? 'text-success' : 'text-warning'}`}>
                            {complete ? 'Consent Obtained' : 'Consent Pending'} — {y.iptr.school_year}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {yrGrade ? `${yrGrade}${yrSection ? ` · ${yrSection}` : ''}` : 'Grade/section not recorded for this year'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                        {complete && y.iptr.consent_given_at
                          ? <>Given<br /><span className="font-medium text-foreground">{formatDate(y.iptr.consent_given_at)}</span></>
                          : '—'}
                      </div>
                    </div>
                    <label className={`flex items-center gap-2 mt-4 pt-4 border-t ${complete ? 'border-green-200' : 'border-amber-200'} ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}>
                      <input
                        type="checkbox"
                        checked={complete}
                        onChange={(e) => {
                          if (canEdit && e.target.checked) setConfirmConsentTarget({ iptrId: y.iptr._id, schoolYear: y.iptr.school_year });
                        }}
                        disabled={!canEdit || complete}
                        title={complete ? 'Consent obtained — this cannot be unchecked' : undefined}
                        className="w-4 h-4 rounded accent-primary disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <span className="text-xs font-medium text-foreground">Consent has been obtained (Nakumpleto na ang pahintulot)</span>
                    </label>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── TAB 4: Dental Records (DMFT History) ── */}
        {activeTab === 'records' && (() => {
          const dmftByYear = years.map((y) => {
            const chart: Record<number, ChartEntry> = {};
            for (const tr of y.toothRecords) chart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
            return { year: y.iptr.school_year, ...computeDMFT(chart) };
          });
          if (dmftByYear.length === 0) return <div className="p-8 text-center text-muted-foreground text-sm">No records yet.</div>;
          return (
          <div className="p-4 space-y-6">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-foreground">DMFT Progression by School Year</h3>
              <p className="text-xs text-muted-foreground">Lowercase (d m f x · dmft) = primary / deciduous teeth; uppercase (D M F X · DMFT) = permanent teeth. A child with both present is in mixed dentition.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">School Year</th>
                    {['d', 'm', 'f', 'x', 'dmft', 'D', 'M', 'F', 'X', 'DMFT'].map((h) => (
                      <th key={h} className={`px-2 py-2 text-center text-xs font-medium ${h === 'dmft' || h === 'DMFT' ? 'bg-gray-100 font-bold text-foreground' : h === h.toLowerCase() ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dmftByYear.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-card' : 'bg-gray-50/50'}>
                      <td className="px-4 py-2 font-medium text-foreground text-xs">{row.year}</td>
                      <td className="px-2 py-2 text-center text-xs text-red-700">{row.d || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-slate-600">{row.m || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-blue-700">{row.f || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-orange-700">{row.x || ''}</td>
                      <td className="px-2 py-2 text-center text-xs font-bold text-foreground bg-gray-100">{row.t}</td>
                      <td className="px-2 py-2 text-center text-xs text-red-700">{row.D || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-slate-600">{row.M || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-blue-700">{row.F || ''}</td>
                      <td className="px-2 py-2 text-center text-xs text-orange-700">{row.X || ''}</td>
                      <td className="px-2 py-2 text-center text-xs font-bold text-foreground bg-gray-100">{row.T}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Latest dmft (primary)', value: dmftByYear[dmftByYear.length - 1].t, color: 'text-red-700 bg-red-50' },
                { label: 'Latest DMFT (permanent)', value: dmftByYear[dmftByYear.length - 1].T, color: 'text-blue-700 bg-blue-50' },
                { label: 'Years tracked', value: dmftByYear.length, color: 'text-foreground bg-gray-100' },
                // A trend needs 2+ years; equal values are Stable, not Improving (DMFT is cumulative)
                { label: 'Trend', value: dmftByYear.length < 2 ? '—' : dmftByYear[dmftByYear.length - 1].T > dmftByYear[0].T ? '↑ Worsening' : dmftByYear[dmftByYear.length - 1].T < dmftByYear[0].T ? '↓ Improving' : 'Stable', color: dmftByYear.length >= 2 && dmftByYear[dmftByYear.length - 1].T > dmftByYear[0].T ? 'text-red-700 bg-red-50' : dmftByYear.length >= 2 && dmftByYear[dmftByYear.length - 1].T < dmftByYear[0].T ? 'text-green-700 bg-green-50' : 'text-foreground bg-gray-100' },
              ].map((kpi, i) => (
                <div key={i} className={`rounded-lg p-3 ${kpi.color}`}>
                  <div className="text-xl font-bold">{kpi.value}</div>
                  <div className="text-xs mt-0.5 opacity-80">{kpi.label}</div>
                </div>
              ))}
            </div>
          </div>
          );
        })()}

        {/* ── TAB 5: Treatment History ── */}
        {activeTab === 'treatments' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Treatment History</h3>
              {canEdit && currentYearData && (
                <button onClick={() => setShowAddTreatment((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover">
                  <Plus className="w-3.5 h-3.5" /> Add Entry
                </button>
              )}
            </div>
            {showAddTreatment && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <p className="text-xs text-blue-700">Adding to school year: <strong>{currentYearData?.iptr.school_year}</strong></p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-foreground mb-1">Date</label>
                    <input type="date" value={treatmentForm.date} onChange={(e) => setTreatmentForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                  <div><label className="block text-xs font-medium text-foreground mb-1">{staffNameLabel}</label>
                    <input type="text" value={user?.name ?? ''} readOnly className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-gray-50 cursor-default text-foreground" /></div>
                  <div><label className="block text-xs font-medium text-foreground mb-1">Diagnosis</label>
                    <textarea rows={2} value={treatmentForm.diagnosis} onChange={(e) => setTreatmentForm((f) => ({ ...f, diagnosis: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></div>
                  <div><label className="block text-xs font-medium text-foreground mb-1">Treatment Done</label>
                    <textarea rows={2} value={treatmentForm.treatmentDone} onChange={(e) => setTreatmentForm((f) => ({ ...f, treatmentDone: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></div>
                  <div className="md:col-span-2"><label className="block text-xs font-medium text-foreground mb-1">Remarks</label>
                    <input type="text" value={treatmentForm.remarks} onChange={(e) => setTreatmentForm((f) => ({ ...f, remarks: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                </div>
                {treatmentError && <p className="text-xs text-destructive">{treatmentError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleAddTreatment} disabled={treatmentSaving} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60">{treatmentSaving ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setShowAddTreatment(false)} className="px-4 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            )}
            {allTreatments.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-12">No treatment records yet.</p>
            ) : (
            <>
            <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>{['Date', 'Diagnosis', 'Treatment Done', 'Dentist', 'Remarks'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-card">
                  {allTreatments.map((t) => (
                    <tr key={t._id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap font-medium text-foreground text-xs">{formatDate(t.date)}</td>
                      <td className="px-4 py-2 text-xs text-foreground">{t.diagnosis}</td>
                      <td className="px-4 py-2 text-xs text-foreground">{t.treatment_done}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-foreground">{dentistNameById.get(t.dentist_id) ?? 'Unknown'}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{t.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3">
              {allTreatments.map((t) => (
                <div key={t._id} className="rounded-lg border bg-card border-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground text-xs">{formatDate(t.date)}</span>
                    <span className="text-xs text-muted-foreground">{dentistNameById.get(t.dentist_id) ?? 'Unknown'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground"><span className="font-medium">Dx:</span> {t.diagnosis}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium">Tx:</span> {t.treatment_done}</p>
                  {t.remarks && <p className="text-xs text-muted-foreground italic">{t.remarks}</p>}
                </div>
              ))}
            </div>
            </>
            )}
          </div>
        )}

        {/* ── TAB 6: Referrals — no Referral model exists in the ERD, so this
             is an honest "not tracked" state rather than a form that implies
             persistence that doesn't exist. ── */}
        {activeTab === 'referrals' && (
          <div className="p-4">
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-muted-foreground">Referral Tracking Not Yet Available</p>
              <p className="text-xs mt-1 max-w-sm mx-auto">There's no referral-tracking model in the system yet. Referrals to outside facilities should be noted in Treatment History remarks for now.</p>
            </div>
          </div>
        )}

        {/* ── TAB 7: AI Risk — the full assessment workflow (generate, validate,
             save) lives on the dedicated Risk Classification page (Sprint 21f);
             this tab just points there rather than duplicating that UI. ── */}
        {activeTab === 'ai' && (
          <div className="p-4">
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-muted-foreground">Risk assessments live on the Risk Classification page</p>
              <p className="text-xs mt-1 max-w-sm mx-auto">Generate, validate, and save AI-assisted risk assessments for this student from the dedicated page. The current model is trained on synthetic placeholder data until real IPTR records are available.</p>
              <Link to="/ai-analytics" className="inline-block mt-4 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg">Open Risk Classification</Link>
            </div>
          </div>
        )}
        </>
        )}
      </div>
      </div>{/* end recordRef — PDF capture region */}
      <ConfirmDialog
        open={confirmDeleteYear !== null}
        title={`Remove ${confirmDeleteYear !== null ? years[confirmDeleteYear]?.iptr.school_year ?? 'school year' : 'school year'}?`}
        message="This archives the entire school year — its dental chart and medical, dietary, and oral-health records. A System Admin can restore it from the archive."
        confirmLabel="Remove year"
        busy={deletingYear}
        onConfirm={confirmDeleteYearNow}
        onCancel={() => setConfirmDeleteYear(null)}
      />
      <ConfirmDialog
        open={confirmClear !== null}
        title={confirmClear === 'treatment' ? `Clear all ${chartedTreatmentCount} treatments?` : `Clear all ${chartedConditionCount} conditions?`}
        message={`This removes every ${confirmClear === 'treatment' ? 'treatment code' : 'condition code'} on this chart, leaving the ${confirmClear === 'treatment' ? 'conditions' : 'treatments'} untouched. Nothing is saved until you click Save Chart — Cancel Edit still discards it.`}
        confirmLabel={confirmClear === 'treatment' ? 'Clear treatments' : 'Clear conditions'}
        onConfirm={() => confirmClear && clearAll(confirmClear)}
        onCancel={() => setConfirmClear(null)}
      />
      <ConfirmDialog
        open={confirmConsentTarget !== null}
        title={`Mark consent as obtained for ${confirmConsentTarget?.schoolYear ?? 'this school year'}?`}
        message="This cannot be undone — once confirmed, this checkbox can no longer be unchecked. Only confirm once the guardian's consent has actually been given."
        confirmLabel="Confirm"
        tone="danger"
        onConfirm={() => {
          if (confirmConsentTarget) handleToggleConsent(confirmConsentTarget.iptrId, true);
          setConfirmConsentTarget(null);
        }}
        onCancel={() => setConfirmConsentTarget(null)}
      />
    </div>
  );
};
