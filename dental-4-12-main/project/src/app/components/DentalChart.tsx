import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, ChevronLeft, ChevronRight, Shield, Users, FileText, Plus, Pencil, Trash2, Download, X, Maximize2, Minimize2, Check, ChevronUp, ChevronDown, ShieldCheck, ShieldAlert, Shield as ShieldIcon, MoreVertical } from 'lucide-react';
import { buildPagesPdf } from '../utils/exportPdf';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { PreviewModal } from './PreviewModal';
import { getGradeColor } from '../utils/gradeColors';
import { BMI_NOTE } from '../utils/bmi';
import { useAuth } from '../context/AuthContext';
import { GradePill } from './GradePill';
import { useToast } from './Toast';
import { useStudentNav } from '../hooks/useStudentNav';
import { validateStudentValues } from '../../../shared/studentValidation';
import { useDentalChartData } from '../hooks/useDentalChartData';
import { apiClient, ApiError } from '../api/client';
import { toLocalDateString, formatDate } from '../utils/localDate';
import { schoolYearLabel } from '../utils/schoolYear';
import { TOPBAR_H } from '../utils/layout';
import { surnameFirst, surnameFirstWithInitial } from '../utils/studentName';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { useSchools } from '../hooks/useSchools';
import { SERVICES as CONSENT_SERVICES } from './ConsentForm';
import { IptrForm, IptrFormPage2 } from './IptrForm';
import { IptrFormV2 } from './IptrFormV2';
import { DmftHistoryTab } from './DmftHistoryTab';
import { AiRiskTab } from './AiRiskTab';
import { TreatmentHistoryTab } from './TreatmentHistoryTab';
import { ReferralsTab } from './ReferralsTab';
import { HistoryTab } from './HistoryTab';
import { emptyMed, emptyDiet, emptyOral, type MedicalHistoryDraft, type DietDraft, type OralDraft } from './iptrDrafts';
import type { ReferralType } from '../api/types';
import {
  sectionBRows,
  teethByTreatment as teethByTreatmentCode,
  hasCaries,
  type ChartedTooth,
} from '../../../shared/iptrSectionB';
// The chart's vocabulary and arithmetic — moved out in Sprint 162, unchanged.
// Re-exported below for the four screens that import these from here.
import {
  upperPermanent,
  lowerPermanent,
  upperTemporary,
  lowerTemporary,
  temporaryTeeth,
  conditionColors,
  computeDMFT,
  WHOLE_MOUTH_TREATMENT_CODES,
  commonConditionCodes,
  rareConditionCodes,
  conditionCodes,
  treatmentCodes,
  perToothTreatmentCodes,
  wholeMouthTreatmentCodes,
  treatmentLabel,
  type ChartEntry,
} from '../utils/dentalChartCodes';

// REFERRAL_TYPE_LABELS moved to ReferralsTab.tsx with the panel that owns it
// (Sprint 162c). ⚠ A second copy still lives in Reports.tsx and the two have
// DRIFTED — see BUG-14.

const ALL_SCHOOL_YEARS = ['2023-2024', '2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029', '2029-2030'];
const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

// The draft shapes and their empty factories moved to `iptrDrafts.ts` in
// Sprint 162c — shared by this host, the History tab and the Dental Chart tab.

const formatDateStamp = (dateString?: string | null) => formatDate(dateString, 'No date stamp');

// ─── Whole-mouth findings, as CHIPS (Sprint 154) ─────────────────────────────
// Layout and wording adopted from the collaborator's `majorUpdates` branch.
// These describe the MOUTH, not a tooth: you do not have calculus "on tooth 26"
// for charting purposes, you either have it or you do not. Stored on
// ORAL_HEALTH_CONDITION, one row per school year, and rendered as chips rather
// than as palette buttons so the difference is visible rather than remembered.
const oralConditionChips: { label: string; field: keyof OralDraft }[] = [
  { label: 'Debris', field: 'debris' },
  { label: 'Gingivitis', field: 'gingivitis' },
  { label: 'Calculus', field: 'calculus' },
  { label: 'Periodontal Disease', field: 'periodontal' },
  { label: 'Cleft Lip / Palate', field: 'cleftLipPalate' },
  { label: 'Abnormal Growth', field: 'abnormalGrowth' },
];

// ─── Services given AT a visit (Sprint 154) ──────────────────────────────────
// Her card, our storage. She kept these on DENTAL_CHART; ours live on
// PREVENTIVE_CARE_RECORD against the RPC visit (Sprint 147), which is what the
// Target Client List and the DOH return actually read. The DESIGN is unchanged
// by that — she draws these apart from the per-tooth codes for the same reason
// we store them apart.
//
// ⚠ Two of her chips are NOT here: "Consultation" and a free-text "Others".
// Neither has a field on PREVENTIVE_CARE_RECORD, and a checkbox that saves
// nowhere is exactly the placeholder CLAUDE.md forbids. Adding them is a model
// change and needs the dentist's word on what Consultation means for the
// return. `oral_hygiene_instruction` is ours and hers has no chip for it.
type ServiceField = 'oral_screening' | 'oral_prophylaxis' | 'fluoride_varnish' | 'oral_hygiene_instruction';
const serviceChips: { label: string; field: ServiceField }[] = [
  { label: 'Oral Examination', field: 'oral_screening' },
  { label: 'Fluoride Varnish', field: 'fluoride_varnish' },
  { label: 'Oral Prophylaxis', field: 'oral_prophylaxis' },
  { label: 'Oral Hygiene Instruction', field: 'oral_hygiene_instruction' },
];

// Charting mode survives the remount between students (Sprint 153).
//
// ⚠ MODULE SCOPE ON PURPOSE. routes.tsx keys this component by `:id`, so
// stepping to the next child UNMOUNTS and remounts it — any useState would
// reset to false and drop the dentist out of full screen on every single
// student, which is the one thing the mode exists to avoid. It is session
// state, not record state, so it belongs neither in the URL nor in the DB.
let chartingModeMemo = false;

// Whether the patient card is expanded, also across the remount (Sprint 166).
// ⚠ Same reason as `chartingModeMemo` above: routes.tsx keys this component by
// `:id`, so Next student remounts it and a useState would spring the card back
// open on every child. Collapsing it is a decision about how you want to WORK,
// not a fact about one pupil, so it should outlive the pupil.
let basicInfoExpandedMemo = true;

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

  // Was useStudents() — the whole roster via /stats/student-rows — used ONLY to
  // build the prev/next nav below (backlog #39). The slim endpoint returns the
  // three fields the nav reads instead of ~13 joined across six collections.
  const { entries: allStudents } = useStudentNav();
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

  // ⚠ 'appointments' (the Consent tab) is gone as of Sprint 171 — six tabs,
  // hers. Consent lives on the History banner, which is where she put it.
  type TabKey = 'history' | 'chart' | 'records' | 'treatments' | 'referrals' | 'ai';
  type IptrContext = 'default' | 'dental-queue' | 'risk' | 'treatment';
  const iptrContext = (searchParams.get('context') as IptrContext) || 'default';
  const [chartingMode, setChartingModeState] = useState(chartingModeMemo);
  const setChartingMode = (on: boolean) => { chartingModeMemo = on; setChartingModeState(on); };
  // An explicit ?tab= still wins — a deep link says where to land. Otherwise a
  // remount inside charting mode has to come back to the CHART tab, or the
  // dentist arrives at the next child on History with the mode still on.
  const initialTab = (searchParams.get('tab') as TabKey) || (chartingModeMemo ? 'chart' : 'history');
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  // Her labels and her order (Sprint 162). "Caries Risk Assessment" says what
  // the tab actually holds where "Risk Classification" only named the output,
  // and it moves up because a dentist reads risk before treatment history.
  //
  // ⚠ CONSENT IS OURS AND STAYS. Her branch has no Consent tab at all — six
  // tabs to our seven — but the tab holds the signed Pahintulot and the consent
  // status, which is a real screen with real data behind it. Adopting a tab
  // ORDER is not a reason to delete a feature, so it keeps the slot it had.
  const allTabs: { key: TabKey; label: string }[] = [
    { key: 'history', label: 'Medical History' },
    { key: 'chart', label: 'Dental Chart' },
    { key: 'ai', label: 'Caries Risk Assessment' },
    { key: 'treatments', label: 'Treatment' },
    { key: 'records', label: 'Dental History' },
    { key: 'referrals', label: 'Referrals' },
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
  const [yearMenuOpen, setYearMenuOpen] = useState(false);
  // ⚠ The menu is rendered FIXED, positioned from the button, because the year
  // strip is `overflow-x-auto` — and once overflow applies on one axis the
  // browser clips the other too. An absolutely positioned dropdown opened
  // inside it rendered at full size and was cut off by the strip, which looked
  // exactly like the button doing nothing.
  const yearMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [yearMenuAt, setYearMenuAt] = useState<{ top: number; right: number } | null>(null);
  const openYearMenu = () => {
    const r = yearMenuBtnRef.current?.getBoundingClientRect();
    if (r) setYearMenuAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setYearMenuOpen((v) => !v);
  };
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  // Wraps the record body for the PDF export, excluding the sticky toolbar —
  // a downloaded patient record should not carry Edit/Save buttons.
  const recordRef = useRef<HTMLDivElement | null>(null);
  // The off-screen DOH form captured by the IPTR PDF button (Sprint 135).
  const iptrFormRef = useRef<HTMLDivElement | null>(null);
  const iptrFormPage2Ref = useRef<HTMLDivElement | null>(null);
  const iptrFormV2Ref = useRef<HTMLDivElement | null>(null);
  // Sprint 148 — WHICH charting of the year is being viewed. Null means "the
  // latest", which is what the hook already hands over.
  //
  // ⚠ Until now the screen rendered the OLDEST charting of the year and hid
  // every later one: 22 of 26 IPTRs on dev have two or more, and a pupil with
  // three showed 3 of their 4 tooth records. A dentist looking at August's
  // findings while January's existed is reading a stale mouth.
  // `?chart=<id>` lands directly on one charting — Record Visit's "chart now"
  // navigates here with the charting it just created (Sprint 149).
  // Sprint 152 — the code palette's WORDS live here now, adopted from the
  // collaborator's design. Her reasoning: the odontogram needs the codes, not
  // the glossary, and a chairside screen has no room for both.
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(
    searchParams.get('chart'),
  );
  // ⚠ NO RESET EFFECT HERE, and that is the point. Two attempts failed: an
  // effect keyed on `selectedYear` fires on mount AND again when the year
  // index resolves once the data loads, and both runs wiped the `?chart=`
  // deep link that Record Visit's "chart now" navigates with — the charting
  // was created and listed, and the screen still opened on a different one.
  //
  // A stale id needs no clearing: the lookup below falls back to the latest
  // charting when the id is not in the year on display, so an id from another
  // year is simply ignored. Both breakages typechecked and built cleanly.
  const { preview, building: pdfBusy, previewPdf, closePreview, confirmDownload } = usePreviewModal();
  const tabsRowRef = useRef<HTMLDivElement | null>(null);
  const [stickyOffsets, setStickyOffsets] = useState({ tabsTop: 0, yearTop: 0 });

  const currentYearDataRaw = years[selectedYear];
  // The hook defaults to the latest charting; this swaps in whichever one the
  // dentist picked, with its own tooth records.
  //
  // ⚠ useMemo IS LOAD-BEARING, not a micro-optimisation (Sprint 154). The
  // spread built a NEW OBJECT on every render, and the draft-sync effect below
  // lists `currentYearData` in its deps — so picking a charting, or arriving on
  // a `?chart=` deep link, put the screen in an INFINITE RENDER LOOP: effect →
  // setDraftChart(new object) → render → new currentYearData → effect. Measured
  // at 6,656 DOM mutations in 2 seconds on an idle page. Because that effect
  // ends in `setEditMode(...)`, Edit Chart could never stay on either: every
  // charting reached through the picker was silently read-only.
  //
  // It typechecked, it built, and the page LOOKED right — the loop is invisible
  // until you count renders or try to edit.
  const currentYearData = useMemo(
    () => (currentYearDataRaw && selectedChartId
      ? {
          ...currentYearDataRaw,
          dentalChart: currentYearDataRaw.charts.find((c) => c._id === selectedChartId) ?? currentYearDataRaw.dentalChart,
          toothRecords: currentYearDataRaw.toothRecordsByChart[selectedChartId] ?? currentYearDataRaw.toothRecords,
        }
      : currentYearDataRaw),
    [currentYearDataRaw, selectedChartId],
  );

  // Draft (editable) copies of the current year's real data -- initialized
  // from real records when the selected year changes, persisted for real on
  // Save. This mirrors the app's existing form pattern (local draft state,
  // explicit save), just backed by real data instead of fake arrays.
  const [draftChart, setDraftChart] = useState<Record<number, ChartEntry>>({});
  const [draftMed, setDraftMed] = useState<MedicalHistoryDraft>(emptyMed());
  const [draftDiet, setDraftDiet] = useState<DietDraft>(emptyDiet());
  const [draftOral, setDraftOral] = useState<OralDraft>(emptyOral());
  // Services given at the visit this charting belongs to (Sprint 154).
  // ⚠ null, not false. PREVENTIVE_CARE_RECORD defaults every service to null
  // and its own comment says why: `false` claims on a form filed with the City
  // Health Office that a service was WITHHELD, where null reads "not
  // recorded". A checkbox is binary, so unticking writes null back — never
  // false. "Explicitly not done" has no tick on the paper form either.
  // Her Physical Measurements block owns these (Sprint 173). They used to be
  // typed inside the Edit Student Info panel and read back as three grey rows
  // on the patient card — two different places for one record. One editor now.
  const [draftMeasure, setDraftMeasure] = useState({ height_cm: '', weight_kg: '', temperature_c: '', blood_pressure: '' });
  const [draftServices, setDraftServices] = useState<Record<ServiceField, boolean | null>>({
    oral_screening: null, oral_prophylaxis: null, fluoride_varnish: null, oral_hygiene_instruction: null,
  });
  const [draftVisitDate, setDraftVisitDate] = useState('');
  const [draftChartDate, setDraftChartDate] = useState('');
  const [othersOralOpen, setOthersOralOpen] = useState(false);
  // Her card collapses (Sprint 164). Identity is checked once on arrival and
  // then only gets in the way of the tab below it.
  const [basicInfoExpanded, setBasicInfoExpandedState] = useState(basicInfoExpandedMemo);
  const setBasicInfoExpanded = (next: boolean | ((v: boolean) => boolean)) => {
    setBasicInfoExpandedState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      basicInfoExpandedMemo = value;
      return value;
    });
  };
  // Consent is confirmed against the FORM, not against a bare "are you sure"
  // (Sprint 169, hers). `revert` distinguishes the two directions.
  const [confirmConsent, setConfirmConsent] = useState<{ schoolYear: string; revert: boolean } | null>(null);
  const [rareConditionsOpen, setRareConditionsOpen] = useState(false);
  const [rareTreatmentsOpen, setRareTreatmentsOpen] = useState(false);

  useEffect(() => {
    if (!currentYearData) {
      setDraftChart({});
      setDraftMed(emptyMed());
      setDraftDiet(emptyDiet());
      setDraftOral(emptyOral());
      setDraftMeasure({ height_cm: '', weight_kg: '', temperature_c: '', blood_pressure: '' });
      setDraftServices({ oral_screening: null, oral_prophylaxis: null, fluoride_varnish: null, oral_hygiene_instruction: null });
      setDraftVisitDate('');
      setDraftChartDate('');
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

    // The dates and services follow the SELECTED charting, not the year: a
    // pupil charted twice has two visits, and showing the first visit's
    // services beside the second's teeth would be a quiet lie.
    const selectedChartRec = currentYearData.dentalChart;
    const visit = selectedChartRec ? currentYearData.preventiveByChart[selectedChartRec._id] : undefined;
    setDraftChartDate(selectedChartRec ? new Date(selectedChartRec.date_charted).toISOString().slice(0, 10) : '');
    setDraftVisitDate(visit ? new Date(visit.visit_date).toISOString().slice(0, 10) : '');
    setDraftMeasure({
      height_cm: currentYearData.iptr.height_cm != null ? String(currentYearData.iptr.height_cm) : '',
      weight_kg: currentYearData.iptr.weight_kg != null ? String(currentYearData.iptr.weight_kg) : '',
      temperature_c: currentYearData.iptr.temperature_c != null ? String(currentYearData.iptr.temperature_c) : '',
      blood_pressure: currentYearData.iptr.blood_pressure ?? '',
    });
    setDraftServices({
      oral_screening: visit?.oral_screening ?? null,
      oral_prophylaxis: visit?.oral_prophylaxis ?? null,
      fluoride_varnish: visit?.fluoride_varnish ?? null,
      oral_hygiene_instruction: visit?.oral_hygiene_instruction ?? null,
    });

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

  // ── Charting mode (Sprint 153) ──────────────────────────────────────────
  // Adopted from the collaborator's `majorUpdates` branch: a full-screen
  // surface for the loop the dentist actually repeats at a school — chart a
  // mouth, save, next child — instead of charting inside a record page with a
  // nav rail, a status strip and six tabs around it.
  //
  // Escape leaves. A mode with no keyboard way out is a trap on a laptop.
  useEffect(() => {
    if (!chartingMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChartingMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartingMode]);

  // Leaving the chart tab leaves the mode. Full screen over History would hide
  // the tab strip that got you there.
  useEffect(() => {
    if (activeTab !== 'chart' && chartingModeMemo) setChartingMode(false);
  }, [activeTab]);

  // ⚠ Stepping to another student while edit mode is on DISCARDS the draft —
  // nothing is written until Save Chart. That hole already existed on the
  // header's prev/next buttons; charting mode makes stepping the main loop, so
  // it is guarded here for both. Confirm-and-lose, never lose silently.
  const [pendingNav, setPendingNav] = useState<{ id: string; name: string } | null>(null);
  const goToStudent = (target: { id: string; name: string } | null) => {
    if (!target) return;
    if (editMode) { setPendingNav(target); return; }
    navigate(`/dental-chart/${target.id}`);
  };

  const currentChart = draftChart;

  // The RPC visit this charting is attached to, if any (Sprint 154). Absent
  // for every charting made before Sprint 149, and for one made here that has
  // not been saved with a service ticked yet (2026-09-25: saving with a
  // service now creates and links the visit — see handleSave).
  const linkedVisitForCard = currentYearData?.dentalChart
    ? currentYearData.preventiveByChart[currentYearData.dentalChart._id]
    : undefined;

  // ── IPTR Section B + per-tooth treatment summary (Sprint 151) ───────────
  //
  // Design adopted from the collaborator's `majorUpdates` branch; the rows and
  // the two readings of the form are hers. The derivation lives in
  // `shared/iptrSectionB.ts` so this panel and the PRINTED Form 1 cannot
  // disagree about the same pupil — they now compute from one function.
  //
  // ⚠ Reads the odontogram being EDITED, so the numbers move as the dentist
  // charts. That is the point: a summary that only updated on save would be
  // wrong for as long as the chart was open.
  const chartedTeeth: ChartedTooth[] = useMemo(
    () => Object.entries(currentChart).map(([tooth, entry]) => ({
      tooth: Number(tooth),
      condition: entry.condition,
      treatment: entry.treatment,
    })),
    [currentChart],
  );
  const indicateNumberRows = useMemo(() => sectionBRows(chartedTeeth), [chartedTeeth]);
  const treatmentTeeth = useMemo(() => teethByTreatmentCode(chartedTeeth), [chartedTeeth]);
  const perToothTreatmentRows = useMemo(
    () => treatmentCodes.filter(
      (t) => !WHOLE_MOUTH_TREATMENT_CODES.includes(t.code) || (treatmentTeeth[t.code]?.length ?? 0) > 0,
    ),
    [treatmentTeeth],
  );

  // Whole-mouth findings. ⚠ Dental Caries is DERIVED from the teeth, never a
  // separate tick — caries is recorded tooth by tooth, and a second source for
  // one fact eventually disagrees with the first.
  const presentOralConditions = useMemo(() => [
    { label: 'Dental Caries', present: hasCaries(chartedTeeth) },
    { label: 'Gingivitis', present: draftOral.gingivitis },
    { label: 'Periodontal Disease', present: draftOral.periodontal },
    { label: 'Debris', present: draftOral.debris },
    { label: 'Calculus', present: draftOral.calculus },
    { label: 'Abnormal Growth', present: draftOral.abnormalGrowth },
    { label: 'Cleft Lip / Palate', present: draftOral.cleftLipPalate },
  ], [chartedTeeth, draftOral]);
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
      setStickyOffsets({ tabsTop: TOPBAR_H + headerHeight, yearTop: TOPBAR_H + headerHeight + tabsHeight });
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

  const handleAddYear = async (target?: string) => {
    // ⚠ Takes a TARGET now (Sprint 172). A pupil with a gap — last record
    // 2024-2025 while today is 2026-2027 — needs to jump to the ACTUAL current
    // year, not merely the one after their last. Her menu offers both.
    const nextYear = target ?? getNextSchoolYear();
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
  // Step-up check before removing a school year (Sprint 178, hers). ⚠ A random
  // field name: the literal string "password" in a name or id is what several
  // autofill engines key off, even with autocomplete overridden, and this must
  // never be filled for you.
  const [yearPassword, setYearPassword] = useState('');
  const [yearPasswordError, setYearPasswordError] = useState<string | null>(null);
  const yearPasswordField = useRef(`confirm-${Math.random().toString(36).slice(2)}`).current;
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
    if (!yearPassword) {
      setYearPasswordError('Enter your password to confirm.');
      return;
    }
    setDeletingYear(true);
    // ⚠ Re-verify the SIGNED-IN user's own password first — hers does this for
    // every year action, and removing a year archives that year's whole record:
    // its chart, tooth records, medical, dietary and oral history. A second
    // click is not a check; a shared machine at a school clinic makes that
    // difference real.
    try {
      await apiClient.post('/auth/verify-password', { password: yearPassword });
    } catch (err) {
      setDeletingYear(false);
      setYearPasswordError(err instanceof ApiError ? err.message : 'Could not verify password.');
      return;
    }
    try {
      await handleDeleteYear(confirmDeleteYear);
      setConfirmDeleteYear(null);
      setYearPassword('');
      setYearPasswordError(null);
    } finally {
      setDeletingYear(false);
    }
  };

  useEffect(() => {
    if (!canEdit) setYearMenuOpen(false);
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

      // A service ticked with zero tooth changes (2026-09-25) must still get a
      // chart to attach its new RPC visit to -- not only pendingTeeth.length,
      // or a Treatments-Given-only save on a pupil's first-ever charting this
      // year would have nowhere to write the visit.
      const hasAnyService = Object.values(draftServices).some((v) => v === true);
      let chartId = currentYearData.dentalChart?._id;
      if (!chartId && (pendingTeeth.length > 0 || hasAnyService)) {
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

      // ── The visit's services and the two dates (Sprint 154; unlocked
      //    2026-09-25) ──────────────────────────────────────────────────────
      // Ticking a service here no longer requires an RPC visit to already
      // exist — it IS what creates one now, per the user's explicit direction
      // that RPC should be derived from the chart and never the other way
      // around. The earlier "deliberately NOT" stance still holds in spirit
      // (an invented visit changes the pupil's 1st/2nd application count on a
      // return filed with the City Health Office): a visit is only ever
      // created when a real service was ticked, never for a bare tooth-only
      // charting with nothing given, and never past the 2 the DOH form allows.
      const linkedVisit = currentYearData.dentalChart
        ? currentYearData.preventiveByChart[currentYearData.dentalChart._id]
        : undefined;
      const extraWrites: Promise<unknown>[] = [];
      // Measurements belong to the YEAR's record. Blank clears back to null
      // rather than storing 0, which would read as "measured at zero" and feed
      // a nonsense BMI.
      const num = (v: string) => (v.trim() === '' ? null : Number(v));
      extraWrites.push(apiClient.put(`/student-iptrs/${currentYearData.iptr._id}`, {
        height_cm: num(draftMeasure.height_cm),
        weight_kg: num(draftMeasure.weight_kg),
        temperature_c: num(draftMeasure.temperature_c),
        blood_pressure: draftMeasure.blood_pressure.trim(),
      }));
      if (linkedVisit) {
        extraWrites.push(apiClient.put(`/preventive-care-records/${linkedVisit._id}`, {
          ...draftServices,
          ...(draftVisitDate ? { visit_date: draftVisitDate } : {}),
        }));
      } else if (hasAnyService && chartId) {
        // Visit number follows whichever of 1/2 this school year doesn't have
        // yet, the same ordinal RPC Monitoring itself derives from visit_date
        // order. Both already taken (rare — the DOH form allows only two) means
        // there is nowhere left to put this one, so the tick is silently not
        // persisted as a visit rather than inventing a 3rd.
        const usedVisitNumbers = new Set(Object.values(currentYearData.preventiveByChart).map((v) => v.visit_number));
        const nextVisitNumber: 1 | 2 | null = !usedVisitNumbers.has(1) ? 1 : !usedVisitNumbers.has(2) ? 2 : null;
        if (nextVisitNumber) {
          const linkChartId = chartId;
          extraWrites.push((async () => {
            const created = await apiClient.post<{ _id: string }>('/preventive-care-records', {
              iptr_id: currentYearData.iptr._id,
              visit_date: draftVisitDate || draftChartDate || toLocalDateString(new Date()),
              visit_number: nextVisitNumber,
              ...draftServices,
            });
            await apiClient.put(`/dental-charts/${linkChartId}`, { preventive_id: created._id });
          })());
        }
      }
      const savedChartId = currentYearData.dentalChart?._id;
      if (savedChartId && draftChartDate
          && draftChartDate !== new Date(currentYearData.dentalChart!.date_charted).toISOString().slice(0, 10)) {
        extraWrites.push(apiClient.put(`/dental-charts/${savedChartId}`, { date_charted: draftChartDate }));
      }

      await Promise.all([...toothWrites, medWrite, dietWrite, oralWrite, ...extraWrites]);
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

  const handleToggleConsent = async (checked: boolean) => {
    const iptrId = yearIptr?._id;
    if (!iptrId || !canEdit) return;
    try {
      // ⚠ The YEAR's record, not the student's. `consent_given_at` is stamped
      // server-side by the model hook — a client-supplied "when was consent
      // given" is not evidence of anything.
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
    // Same shared rules as the Add form and the bulk import (Sprint 120). Only
    // ONE of the 27 records on file fails them (a contact number), so this
    // blocks almost nothing that already exists -- but it does mean a legacy
    // bad value must be corrected before that pupil can be edited, which is
    // the point. Undefined fields are skipped, so editing a name never trips
    // on a phone the encoder is not looking at.
    const problems = validateStudentValues({
      lastName: draftInfo.last_name,
      firstName: draftInfo.first_name,
      middleName: draftInfo.middle_name,
      birthdate: draftInfo.birthday ? String(draftInfo.birthday).slice(0, 10) : undefined,
      contactNumber: draftInfo.contact_number,
      guardianContact: draftInfo.guardian_contact,
    });
    if (problems.length) {
      setInfoError(problems.join(' '));
      return;
    }
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
          // ⚠ height_cm/weight_kg deliberately NOT written here (Sprint 173).
          // Physical Measurements on the History tab owns them now; sending
          // them from this panel too would let a stale draft overwrite a fresh
          // measurement depending on which save ran last.
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

  // ── Referrals (Sprint 127) ──────────────────────────────────────────────
  // Combined across school years, most recent first — the same shape as
  // Treatment History above, because it answers the same kind of question.
  const allReferrals = useMemo(
    () => years.flatMap((y) => y.referrals).sort((a, b) => b.date_issued.localeCompare(a.date_issued)),
    [years],
  );

  const [showAddReferral, setShowAddReferral] = useState(false);
  const [referralForm, setReferralForm] = useState({
    date: toLocalDateString(new Date()),
    referralType: 'higher_level' as ReferralType,
    facility: '',
    reason: '',
    followUp: '',
    notes: '',
  });
  const [referralSaving, setReferralSaving] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);

  const handleAddReferral = async () => {
    if (!currentYearData) {
      setReferralError('This student has no record for the selected school year.');
      return;
    }
    // `date_issued` is required on the model. Without this check, clearing the
    // date posts an empty string, Mongoose casting fails, and the raw server
    // validation string surfaces in the panel.
    if (!referralForm.date || !referralForm.facility.trim() || !referralForm.reason.trim()) {
      setReferralError('Date issued, facility and reason are required.');
      return;
    }
    setReferralSaving(true);
    setReferralError(null);
    try {
      await apiClient.post('/referrals', {
        iptr_id: currentYearData.iptr._id,
        // Nullable on the model: an aide can record a referral, and no dentist
        // record is linked to an aide's account.
        dentist_id: currentDentist?._id ?? null,
        referral_type: referralForm.referralType,
        date_issued: referralForm.date,
        facility_name: referralForm.facility.trim(),
        reason: referralForm.reason.trim(),
        notes: referralForm.notes.trim(),
        // `status` and `follow_up_date` are deliberately left to the model's
        // defaults unless a date is typed — referrals are ISSUE-ONLY until the
        // dentist confirms that closing one out is a real part of her workflow.
        ...(referralForm.followUp ? { follow_up_date: referralForm.followUp } : {}),
      });
      await reload();
      toast.success('Referral recorded.');
      setReferralForm({
        date: toLocalDateString(new Date()),
        referralType: 'higher_level',
        facility: '',
        reason: '',
        followUp: '',
        notes: '',
      });
      setShowAddReferral(false);
    } catch (err) {
      setReferralError(err instanceof ApiError ? err.message : 'Failed to save referral');
    } finally {
      setReferralSaving(false);
    }
  };

  const showStickyYearBar = activeTab === 'history' || activeTab === 'chart';
  const backPath = iptrContext === 'risk' ? '/ai-analytics' : iptrContext === 'treatment' ? '/treatment-records' : '/dental-charts';

  // ⚠ ABOVE THE EARLY RETURNS ON PURPOSE. This is a HOOK, and the
  // `if (loading)` / `if (error)` guards below return before the rest of the
  // component runs — a useMemo placed after them runs on some renders and
  // not others, which is exactly the "Rendered more hooks than during the
  // previous render" crash that blanked this page in c0ce442b. tsc and the
  // build were clean for it; only opening the screen showed it.
  // ⚠ Consent is per SCHOOL YEAR (Sprint 167). Reading STUDENT.consent_status
  // said a pupil who consented once had consented forever — a 2023 signature
  // authorising 2026 treatment.
  // ⚠ Age in MONTHS at this year's measurement anchor, not today — the
  // DOH/DepEd BMI-for-Age table is banded by month, and a pupil measured in
  // August is not the age they are in June. Same reasoning as patientAge
  // (Sprint 57b).
  const patientAgeMonths = useMemo(() => {
    // Reads the year off `years[selectedYear]` rather than the `yearIptr`
    // const, which is declared further down — a hook cannot depend on a
    // binding that does not exist yet at this point in the component.
    const schoolYear = years[selectedYear]?.iptr.school_year;
    if (!student?.birthday || !schoolYear) return null;
    const born = new Date(student.birthday);
    if (Number.isNaN(born.getTime())) return null;
    // End of the school year: June 30 of its second half.
    const anchor = new Date(Number(String(schoolYear).slice(0, 4)) + 1, 5, 30);
    return (anchor.getFullYear() - born.getFullYear()) * 12 + (anchor.getMonth() - born.getMonth());
  }, [student?.birthday, years, selectedYear]);

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
  const consentComplete = yearIptr?.consent_status === 'complete';
  const yearGrade = yearIptr?.grade_level ?? null;
  const yearSection = yearIptr?.section ?? null;

  // The patient's own record as a PDF — Sprint 52 named this "the one export a
  // clinic actually needs (a patient's own record for their file)".
  //
  // ⚠ Sprint 135 changed WHAT is captured. It used to capture `recordRef`, the
  // on-screen record region: the patient-info card, the tab strip, the Edit
  // buttons, whatever tab happened to be open. That is a screenshot of the app,
  // and it is the document a family or a referral is handed. It now captures
  // the real DOH form, built to the scan in the manuscript (Appendix G).
  //
  // `iptrFormRef` renders off-screen rather than conditionally: html2canvas
  // needs a laid-out element, so `display: none` would capture nothing.
  // ⚠ Declared at the TOP of the component with the other hooks, not here:
  // this function sits after the `if (loading)` / `if (error)` early returns,
  // and a hook after a conditional return changes the hook ORDER between
  // renders ("Rendered more hooks than during the previous render").
  // ⚠ TWO IPTR FORMS ARE VALID AT ONCE (user, 2026-09-05), so this is a CHOICE,
  // not a single action. `patient` is the Taguig City Health Office "Individual
  // PATIENT Treatment Record" (manuscript Appendix G, two pages); `form1` is
  // the DOH Center for Health Development "Individual Treatment Record". They
  // are different documents and are never merged.
  const onIptrPdf = (which: 'patient' | 'form1') => {
    const who = surnameFirst(student).replace(/[^\w]+/g, '-');
    if (which === 'form1') {
      if (!iptrFormV2Ref.current) return;
      const el = iptrFormV2Ref.current;
      previewPdf('Individual Treatment Record (DOH Form 1)', `ITR_Form1_${who}.pdf`, () => buildPagesPdf([el]));
      return;
    }
    if (!iptrFormRef.current) return;
    // TWO PDF PAGES, because that form is a two-page form (Sprint 136).
    // Capturing both into one tall page would produce a document that is not
    // the form.
    const pages = [iptrFormRef.current, iptrFormPage2Ref.current].filter((el): el is HTMLDivElement => el !== null);
    previewPdf('Individual PATIENT Treatment Record', `IPTR_${who}.pdf`, () => buildPagesPdf(pages));
  };

  // ⚠ THE WIDTH. This wrapper carried `max-w-5xl mx-auto` — a 1024px cap with
  // the leftover space split either side — which is why the record screen sat
  // in a narrow column while every other screen in the app ran the full width
  // of the content area. Hers is `w-full`, and hers is right here: the
  // odontogram is 32 teeth across and the summaries are a two-column grid,
  // both of which were being squeezed for no reason. Sprint 165.
  return (
    <div className="space-y-4 w-full">
      {/* The printable form, off-screen. Kept mounted so the PDF button has a
          laid-out element to capture; `aria-hidden` so it is not read twice by
          a screen reader, and it carries `.form-print` so a browser print of
          this page produces the FORM, not the app. */}
      <div aria-hidden className="fixed -left-[10000px] top-0">
        <div ref={iptrFormRef}><IptrForm student={student} years={years} dentists={dentists} /></div>
        <div ref={iptrFormPage2Ref}><IptrFormPage2 years={years} /></div>
        <div ref={iptrFormV2Ref}><IptrFormV2 student={student} schoolName={schoolName} years={years} /></div>
      </div>
      {/* Sticky header row */}
      <div ref={headerRowRef} className="sticky z-40 bg-gray-50 pt-3 pb-2" style={{ top: TOPBAR_H }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={backPath} className="p-2 hover:bg-gray-100 rounded-lg shrink-0">
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground">Individual Patient Treatment Record</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* PDF ONLY — no Excel, deliberately. This is one patient's own
              record, the document a family or a referral needs; a spreadsheet
              of a single patient serves nobody and would be a decrypted PII
              file with no filing purpose. Sprint 52 removed the bulk patient
              exports for exactly that reason and named THIS as the one export
              a clinic actually needs. */}
          {/* Both forms are in use, so both are offered and the button says
              WHICH — a single "PDF" button would have to pick one silently. */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onIptrPdf('patient')}
              disabled={pdfBusy}
              title="Download the Individual PATIENT Treatment Record (City Health Office, 2 pages)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />{pdfBusy ? 'Preparing…' : 'IPTR'}
            </button>
            <button
              onClick={() => onIptrPdf('form1')}
              disabled={pdfBusy}
              title="Download the Individual Treatment Record (DOH Form 1)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />{pdfBusy ? 'Preparing…' : 'Form 1'}
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-1 border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => goToStudent(prevPatient)}
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
              onClick={() => goToStudent(nextPatient)}
              disabled={!nextPatient}
              title={nextPatient ? `${nextPatient.name} →` : undefined}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default border-l border-border"
            >
              {nextPatient ? <span className="max-w-[80px] truncate">{nextPatient.lastName || nextPatient.name}</span> : 'Last'}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* The year arrows are gone (Sprint 163, her header). The year CHIPS
              row directly under the tab strip already selects the school year,
              names its exam date and shows its DMFT — two controls for one
              choice, one of which said less. */}
        </div>
      </div>
      </div>

      {/* Everything below the sticky toolbar is the record itself, and is what
          the PDF captures. */}
      <div ref={recordRef} className="space-y-4">
      {/* Patient Info Card */}
      <div className="bg-card rounded-xl border-2 border-primary shadow-[0_8px_24px_rgba(15,23,42,0.08)] p-4">
        {editingInfo ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Edit Student Info</span>
              <div className="flex gap-2">
                <button onClick={handleSaveInfo} disabled={infoSaving} className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60">{infoSaving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setEditingInfo(false)} className="px-3 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </div>
            {infoError && <p className="text-xs text-destructive">{infoError}</p>}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {/* Three boxes, matching the DOH IPTR paper form. full_name is
                  derived server-side from these, so it is not edited directly. */}
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Last Name</label>
                <input type="text" value={draftInfo.last_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, last_name: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">First Name</label>
                <input type="text" value={draftInfo.first_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, first_name: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Middle Name</label>
                <input type="text" value={draftInfo.middle_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, middle_name: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Contact Number</label>
                <input type="text" value={draftInfo.contact_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, contact_number: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Guardian Name</label>
                <input type="text" value={draftInfo.guardian_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_name: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Guardian Contact</label>
                <input type="text" value={draftInfo.guardian_contact ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_contact: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              {/* ── This school year's record ──────────────────────────────
                  Everything from here down saves to the SELECTED YEAR's IPTR,
                  not to the student. Two grades exist on purpose: the student
                  carries their CURRENT enrolment (what rosters and the
                  appointment picker read), and each year carries the grade the
                  pupil was actually in then (Sprint 57a). They differ for a
                  retained pupil, and for every past year once anyone is
                  promoted — which is the whole reason the year keeps its own. */}
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">
                  Grade <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span>
                </label>
                <select value={draftYear.grade_level}
                  onChange={(e) => setDraftYear((p) => ({ ...p, grade_level: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs bg-card">
                  <option value="">Not recorded</option>
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">
                  Section <span className="font-normal">· {years[selectedYear]?.iptr.school_year}</span>
                </label>
                <input type="text" placeholder="Not recorded" value={draftYear.section}
                  onChange={(e) => setDraftYear((p) => ({ ...p, section: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              {/* ⚠ Height, Weight and the BMI preview are NOT edited here any
                  more (Sprint 173). They moved to Physical Measurements on the
                  History tab, alongside temperature and blood pressure, which
                  is where hers are and where the BMI they feed is read. Two
                  panels writing one field is how they drift.

                  Grade and Section stay: those are enrolment, not measurements,
                  and this panel is where a retained pupil's year is corrected
                  (Sprint 70). */}
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">PhilHealth No.</label>
                <input type="text" value={draftInfo.philhealth_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_number: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Birthday</label>
                <input type="date" value={draftInfo.birthday?.slice(0, 10) ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, birthday: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Sex</label>
                <select value={draftInfo.sex ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, sex: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs bg-card">
                  <option>Male</option><option>Female</option>
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Grade <span className="font-normal">· current</span></label>
                <select value={draftInfo.grade_level ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, grade_level: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs bg-card">
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">Section <span className="font-normal">· current</span></label>
                <input type="text" value={draftInfo.section ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, section: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div>
                <label className="block text-muted-foreground font-medium mb-0.5">PhilHealth Status</label>
                <select value={draftInfo.philhealth_status ?? 'None'} onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_status: e.target.value as 'None' | 'Principal' | 'Dependent' }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs bg-card">
                  <option>Dependent</option><option>Principal</option><option>None</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-muted-foreground font-medium mb-0.5">School</label>
                <select value={schoolName} disabled className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-gray-50 text-muted-foreground">
                  {schoolNames.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-muted-foreground font-medium mb-0.5">Address</label>
                <input type="text" value={draftInfo.address ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, address: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-xs" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="4ps" checked={!!draftInfo.is_4ps} onChange={(e) => setDraftInfo((p) => ({ ...p, is_4ps: e.target.checked }))}
                  className="w-4 h-4 rounded accent-primary" />
                <label htmlFor="4ps" className="text-foreground font-medium">4Ps Member</label>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div style={{ backgroundColor: gc.light, color: gc.solid }} className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg">
                  {[student.first_name?.[0], student.last_name?.[0]].filter(Boolean).join('') || student.full_name?.[0]}
                </div>
                <div>
                  <div className="font-bold text-foreground">{surnameFirstWithInitial(student)}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {/* Nothing when the year has no recorded grade — the detail
                        line directly above already says so, and repeating it
                        here just doubled the same sentence. */}
                    {yearGrade && <GradePill grade={yearGrade} />}
                    {yearSection && <span style={{ color: gc.solid }} className="text-xs font-medium">{yearSection}</span>}
                    {student.is_4ps && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">4Ps</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Her chips. ⚠ READ-ONLY here on purpose — consent has its own
                    tab and its own toggle, and editing student info must never
                    reach it. */}
                <span
                  title={`${consentComplete ? 'Consent obtained' : 'Consent pending'} for ${yearIptr?.school_year ?? 'this year'}`}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${consentComplete ? 'bg-success-surface text-success' : 'bg-warning-surface text-warning'}`}
                >
                  {consentComplete ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  {consentComplete ? 'Consent Complete' : 'Consent Pending'}
                </span>
                {/* Colour rather than neutral grey, so sex reads at a glance —
                    and it stays visible while the card is collapsed. */}
                {student.sex && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${student.sex === 'Male' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                    {student.sex}
                  </span>
                )}
                {canEditInfo && (
                  <button onClick={openEditInfo} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-gray-50">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
                {/* ⚠ The button CARRIES ITS LABEL WHEN COLLAPSED. The state
                    persists across pupils (Sprint 166), so a bare chevron meant
                    the birthday, address, PhilHealth and guardian simply were
                    not there on every record for the rest of the session, with
                    nothing on screen saying they could come back. Reported as
                    "basic patient info missing", which is exactly right: hidden
                    content needs a way in that reads as one. */}
                <button
                  onClick={() => setBasicInfoExpanded((v) => !v)}
                  title={basicInfoExpanded ? 'Hide basic information' : 'Show basic information'}
                  aria-label={basicInfoExpanded ? 'Hide basic information' : 'Show basic information'}
                  aria-expanded={basicInfoExpanded}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium border border-border rounded-lg text-muted-foreground hover:bg-gray-50"
                >
                  {basicInfoExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {!basicInfoExpanded && 'Basic info'}
                </button>
              </div>
            </div>
            {basicInfoExpanded && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                // "May 30, 2013", not 2013-05-30 — hers, and it is what a person
                // reads a birthday as.
                // Her field ORDER, not just her fields: Birthday, Age, Place of
                // Birth, Sex — then Address, Occupation, Contact.
                ['Birthday', student.birthday ? formatDate(student.birthday) : '—'],
                ['Age', `${patientAge} years`],
                ['Place of Birth', student.place_of_birth || '—'],
                ['Sex', student.sex],
                ['Address', student.address],
                // Guardian's occupation — the label is "Occupation" on the paper
                // IPTR and on her card, so it stays that word here too.
                ['Occupation', student.guardian_occupation || '—'],
                ['Contact', student.contact_number || '—'],
                ['Guardian', student.guardian_name || '—'],
                ['Guardian Contact', student.guardian_contact || '—'],
                ['PhilHealth', `${student.philhealth_number || '—'} (${student.philhealth_status || 'None'})`],
                // ⚠ Height, Weight and BMI are NOT here any more (Sprint 173,
                // hers). This card is identity and contact facts; a clinical
                // measurement belongs with the rest of the measurements, on
                // History, where it is also entered.
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-muted-foreground font-medium">{label}</div>
                  <div className="text-foreground" title={label === 'BMI' ? BMI_NOTE : undefined}>{val}</div>
                </div>
              ))}
            </div>
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="sticky z-30 bg-gray-50 space-y-0" style={{ top: stickyOffsets.tabsTop }}>
        <div className="overflow-hidden bg-card rounded-xl border-2 border-primary">
          <div ref={tabsRowRef} className="border-b border-border bg-card">
            <div className="flex items-center">
              {/* Her strip: every tab takes an equal share of the card's
                  width and its label is centred, instead of the tabs hugging
                  their text at the left edge. The active tab is BOLD with the
                  underline and no blue fill — the fill made the strip read as
                  two different controls.

                  ⚠ `whitespace-nowrap` + the scroller: a two-line "Caries Risk
                  Assessment" makes the whole strip taller and knocks every
                  other label off the baseline. Labels stay on one line and the
                  strip scrolls inside itself once they stop fitting, which is
                  the house rule for tab strips at phone width. */}
              {/* ⚠ `flex-1` only when there is more than one tab. The risk
                  context renders a SINGLE tab, and stretched across the whole
                  card it stops reading as a tab and starts reading as a
                  heading — an underlined title nobody would think to press. */}
              <div className="flex flex-1 min-w-0 overflow-x-auto">
              {visibleTabs.map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key as TabKey)}
                  aria-current={activeTab === tab.key ? 'page' : undefined}
                  className={`${visibleTabs.length > 1 ? 'flex-1' : 'px-6'} whitespace-nowrap px-3 py-2.5 my-1 mx-1 rounded-xl text-sm text-center transition-colors focus:outline-none focus-visible:outline-none ${activeTab === tab.key ? 'font-bold bg-primary text-white' : 'font-medium text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                  {tab.label}
                </button>
              ))}
              </div>
              {/* ⚠ The chart tab no longer belongs to the dentist alone. Sprint
                  176 moved Oral Health Condition here, and Sprint 154 put the
                  Oral Conditions and Treatments Given card here — both are
                  `editingHistory` data, which a DENTAL AIDE may edit. The old
                  condition only offered the pencil on this tab to `canEdit`
                  (dentist), so an aide stood in front of fields they are
                  allowed to change with no way to start changing them: they
                  had to go to History, press the pencil there, then come back.
                  Teeth remain dentist-only through `editingChart`. */}
              {canEditHistory && currentYearData && (editMode || activeTab === 'history' || activeTab === 'chart') && (
                <div className="flex shrink-0 items-center gap-2 px-3">
                  {!editMode ? (
                    /* Icon only, at the right end of the tab strip — her
                       control. The label moves to the tooltip and the aria
                       label, so a screen reader and a hover still say which
                       of the two things this edits. */
                    <button onClick={() => setEditMode(true)}
                      title={canEdit ? 'Edit chart' : 'Edit history & oral'}
                      aria-label={canEdit ? 'Edit chart' : 'Edit history & oral'}
                      className="flex items-center justify-center rounded-lg border border-border p-2 text-foreground transition-colors hover:bg-muted">
                      <Pencil className="w-4 h-4" />
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
                // BUG-12: the year's DMFT comes from the latest charting that
                // HAS records, not from whichever charting is newest. An empty
                // charting made this read "DMFT: 0" for a pupil with 14 decayed
                // teeth recorded a day earlier. Null prints "—", not 0.
                const yrChart: Record<number, ChartEntry> = {};
                for (const tr of y.dmftToothRecords ?? []) yrChart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
                const yrDmft = computeDMFT(yrChart);
                const yrDmftLabel = y.dmftToothRecords ? `${yrDmft.T + yrDmft.t}` : '—';
                const isActive = selectedYear === idx;
                return (
                  <div key={y.iptr._id} className={`mr-1 flex flex-shrink-0 items-stretch border-b-2 ${isActive ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                    <button type="button" onClick={() => setSelectedYear(idx)} className="px-4 py-2.5 text-left text-xs font-medium transition-all">
                      <div>{y.iptr.school_year}</div>
                      {activeTab === 'chart' && (
                        <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'} title={y.dmftToothRecords ? undefined : 'No charting this school year recorded a tooth'}>DMFT: {yrDmftLabel}</div>
                      )}
                      <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'}>
                        {formatDateStamp(y.dentalChart?.date_charted)}
                      </div>
                    </button>
                    {false && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteYear(idx); }} className="border-l border-border px-2 text-muted-foreground transition-colors hover:bg-card hover:text-destructive" title={`Remove ${y.iptr.school_year}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {/* ⚠ Her ⋮ menu, replacing "Edit Years" (Sprint 172). The old
                  control was a MODE: press it, trash icons appear on every
                  year chip, press again to leave. A mode that arms a
                  destructive action on every row is a worse shape than a menu
                  that names one thing and does it.

                  Delete now acts on the SELECTED year, which is the one whose
                  data is on screen — you cannot arm a delete for a year you
                  are not looking at.

                  NOT copied: her "Edit <year>'s date" item. It writes
                  `date_opened`, which her STUDENT_IPTR has and ours does not.
                  A menu item that saves nowhere is the placeholder CLAUDE.md
                  forbids, so it is left out rather than stubbed. */}
              {canEdit && (
                <div className="relative ml-2 flex-shrink-0 py-2">
                  <button type="button" ref={yearMenuBtnRef} onClick={openYearMenu}
                    title="School year options" aria-label="School year options" aria-expanded={yearMenuOpen}
                    className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-gray-50">
                    School year <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                  {yearMenuOpen && (
                    <>
                      {/* Click-away sheet, under the menu and over everything
                          else — without it the menu only closes by re-pressing
                          the button, which nobody does. */}
                      <div className="fixed inset-0 z-10" onClick={() => setYearMenuOpen(false)} />
                      <div
                        style={yearMenuAt ? { top: yearMenuAt.top, right: yearMenuAt.right } : undefined}
                        className="fixed z-50 w-52 rounded-xl border border-border bg-card shadow-md py-1"
                      >
                        {(() => {
                          const nextYear = getNextSchoolYear();
                          const currentYear = schoolYearLabel();
                          const existing = new Set(years.map((y) => y.iptr.school_year));
                          const showCurrent = !existing.has(currentYear);
                          const showNext = !!nextYear && nextYear !== currentYear && !existing.has(nextYear);
                          return (
                            <>
                              {showCurrent && (
                                <button type="button" disabled={addingYear}
                                  onClick={() => { setYearMenuOpen(false); handleAddYear(currentYear); }}
                                  className="block w-full text-left px-3 py-2 text-xs text-foreground hover:bg-canvas disabled:opacity-50">
                                  Add {currentYear} <span className="text-muted-foreground">(current)</span>
                                </button>
                              )}
                              {showNext && (
                                <button type="button" disabled={addingYear}
                                  onClick={() => { setYearMenuOpen(false); handleAddYear(nextYear); }}
                                  className="block w-full text-left px-3 py-2 text-xs text-foreground hover:bg-canvas disabled:opacity-50">
                                  Add {nextYear} <span className="text-muted-foreground">(next)</span>
                                </button>
                              )}
                              {!showCurrent && !showNext && (
                                <div className="px-3 py-2 text-xs text-muted-foreground">Current and next year already recorded</div>
                              )}
                            </>
                          );
                        })()}
                        {years.length > 1 && (
                          <button type="button"
                            onClick={() => { setYearMenuOpen(false); setConfirmDeleteYear(selectedYear); }}
                            className="block w-full text-left px-3 py-2 text-xs text-destructive hover:bg-danger-surface">
                            Remove {years[selectedYear]?.iptr.school_year}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Sprint 163 — Charting Mode and Legend sit at the right end of
                  the YEAR ROW, level with the year chips, which is where hers
                  are. They were below the charting picker, half a screen down
                  from the tab that owns them. Chart tab only: neither means
                  anything on History or Consent. */}
              {activeTab === 'chart' && (
                <div className="ml-auto flex flex-shrink-0 items-center gap-2 py-2 pr-1">
                  {!chartingMode && (
                    <button
                      type="button"
                      onClick={() => setChartingMode(true)}
                      title="Full-screen charting — Escape exits"
                      className="flex items-center gap-1.5 rounded-lg border border-primary px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                    >
                      <Maximize2 className="w-3.5 h-3.5" /> Charting Mode
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setLegendOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
                  >
                    <FileText className="w-3.5 h-3.5" /> Legend
                  </button>
                </div>
              )}
              </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CONSENT BANNER (Sprint 167, hers) ──────────────────────────────
          History tab only. It is registration data — a dentist mid-chart or
          mid-treatment-entry does not need it repeated on every tab, and the
          card's chip above already carries the status everywhere else.

          ⚠ NO APPROVAL DATE SHOWN, even though `consent_given_at` now exists:
          every record predating this sprint has null there, and printing
          "—" beside a completed consent reads as a missing signature rather
          than a missing field. It goes in once the data is real. */}
      {activeTab === 'history' && years.length > 0 && yearIptr && (
        <div className="flex rounded-xl overflow-hidden border border-border shadow-[0_4px_14px_rgba(15,23,42,0.08)]">
          <div className={`w-14 flex-shrink-0 flex items-center justify-center ${consentComplete ? 'bg-[#15803D]' : 'bg-[#B45309]'}`}>
            {consentComplete ? <ShieldCheck className="w-5 h-5 text-white" /> : <ShieldAlert className="w-5 h-5 text-white" />}
          </div>
          <div className="flex-1 bg-card px-4 py-3 flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold text-foreground">
                {consentComplete
                  ? `Physical copy of consent obtained for ${yearIptr.school_year}`
                  : `Consent pending for ${yearIptr.school_year}`}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {yearGrade ? (
                  <>
                    <span
                      style={{ backgroundColor: gc.light, color: gc.solid, borderColor: gc.solid + '40' }}
                      className="inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[10.5px] font-semibold leading-none"
                    >
                      {yearGrade}
                    </span>
                    {yearSection && <span className="text-[10.5px] font-medium text-muted-foreground">{yearSection}</span>}
                  </>
                ) : (
                  <span className="text-[10.5px] text-muted-foreground">Grade/section not recorded for this year</span>
                )}
              </div>
            </div>
            {/* ⚠ SHOWN IN BOTH STATES, unlike hers. Her banner hides this once
                consent is complete, which works on her branch because she treats
                the tick as final. Ours can be reverted — and the Consent TAB that
                offered that is gone as of this sprint, so if the box vanished
                when ticked, a mis-tick would be unfixable outside the database.
                Both directions open the confirmation. */}
            <button
              type="button"
              onClick={() => { if (canEdit) setConfirmConsent({ schoolYear: yearIptr.school_year, revert: consentComplete }); }}
              disabled={!canEdit}
              className={`flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-full flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${canEdit ? 'cursor-pointer' : 'cursor-default'} ${consentComplete ? 'bg-[#F0FDF4]' : 'bg-[#F1F5F9]'}`}
            >
              <span className={`w-8 h-[18px] rounded-full relative inline-block ${consentComplete ? 'bg-[#15803D]' : 'bg-[#E2E8F0]'}`}>
                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] ${consentComplete ? 'right-0.5' : 'left-0.5'}`} />
              </span>
              <span className={`text-[11px] font-semibold ${consentComplete ? 'text-[#15803D]' : 'text-[#475569]'}`}>
                {consentComplete ? 'Obtained' : 'Mark obtained'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div className="relative overflow-hidden bg-card rounded-xl border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <div className="absolute top-0 left-0 right-0 h-1 bg-teal-600 z-10" />

        {years.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-sm">No IPTR school-year records yet for this student.</p>
            {canEdit && <button onClick={() => handleAddYear()} disabled={addingYear} className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed">+ Start {getNextSchoolYear()}</button>}
          </div>
        ) : (
        <>
        {/* ── TAB 1: History ── */}
        {activeTab === 'history' && (
          <HistoryTab
            editing={editingHistory}
            measure={draftMeasure}
            setMeasure={setDraftMeasure}
            med={draftMed}
            setMed={setDraftMed}
            diet={draftDiet}
            setDiet={setDraftDiet}
            patientAgeMonths={patientAgeMonths}
            sex={student.sex}
          />
        )}

        {/* ── TAB 2: Dental Chart ── */}
        {activeTab === 'chart' && (
          /* ⚠ The SAME JSX renders in both states — charting mode only changes
             this container. Duplicating the odontogram into a separate overlay
             component is how two charting surfaces drift apart. z-[75] clears
             the nav rail, which is what frees the full width. */
          <div className={chartingMode ? 'fixed inset-0 z-[75] bg-canvas overflow-y-auto overscroll-contain' : 'p-0 space-y-0'}>
            {chartingMode && (
              /* flex-wrap + min-w-0, not a bare justify-between: this bar is
                 read on a tablet at the chair as well as on a laptop. */
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2">
                <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-base font-bold text-foreground truncate">{surnameFirst(student)}</span>
                  {/* The same coloured pills the patient card uses. Charting
                      mode is exactly where a dentist confirms they have the
                      right child, so it should not invent a new way to say it. */}
                  {yearGrade && <GradePill grade={yearGrade} />}
                  {yearSection && (
                    <span style={{ backgroundColor: gc.light, color: gc.solid }}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">{yearSection}</span>
                  )}
                  <span className="h-4 w-px bg-border" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {currentYearData?.iptr.school_year}
                    {navIndex >= 0 ? ` · ${navIndex + 1} of ${navList.length}` : ''}
                  </span>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {canEdit && (editMode ? (
                    <>
                      <button onClick={cancelEdit} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                        Cancel
                      </button>
                      <button onClick={handleSave} disabled={saving}
                        className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${saved ? 'bg-green-600' : 'bg-primary hover:bg-primary-hover'}`}>
                        <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save Chart'}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                      <Pencil className="w-3.5 h-3.5" /> Edit Chart
                    </button>
                  ))}
                  <div className="flex items-center rounded-lg border border-border overflow-hidden">
                    <button onClick={() => goToStudent(prevPatient)} disabled={!prevPatient}
                      title={prevPatient ? `← ${prevPatient.name}` : undefined}
                      className="flex items-center gap-1 border-r border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default">
                      <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>
                    <button onClick={() => goToStudent(nextPatient)} disabled={!nextPatient}
                      title={nextPatient ? `${nextPatient.name} →` : undefined}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default">
                      Next student <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button onClick={() => setChartingMode(false)} title="Exit charting mode (Esc)"
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                    <Minimize2 className="w-3.5 h-3.5" /> Exit
                  </button>
                </div>
              </div>
            )}
            <div className="p-4 space-y-4">
            {/* ── ORAL CONDITIONS / TREATMENTS GIVEN (Sprint 154) ──────────
                Card, columns, chips, inline dates and the Others expander are
                the collaborator's, from `majorUpdates`, and it opens the tab
                because that is where she put it: a screening records the mouth
                before it reaches for a tooth code.

                ⚠ DELIBERATELY OUTSIDE the blue palette card, which is gated on
                `editingChart` (dentist only, because teeth are). Folding these
                in would silently take the oral-condition boxes away from the
                dental aide, who has always been able to edit them. Conditions
                follow `editingHistory` (dentist + aide); services follow
                `editingChart`.

                Her storage is the one thing not copied: she added these to
                DENTAL_CHART, ours live on ORAL_HEALTH_CONDITION and on the RPC
                visit's PREVENTIVE_CARE_RECORD (Sprint 147), which is what the
                Target Client List and the DOH return read. */}
            <div className="bg-card rounded-xl border border-primary/30 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={editingHistory ? '' : 'opacity-60 pointer-events-none select-none'}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="text-sm font-bold text-primary uppercase tracking-wide">Oral Conditions</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Date examined
                    <input type="date" value={draftChartDate} disabled={!currentYearData?.dentalChart}
                      onChange={(e) => setDraftChartDate(e.target.value)}
                      title={currentYearData?.dentalChart ? undefined : 'No charting recorded for this school year yet'}
                      className="border border-border rounded px-2 py-1 text-xs bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {oralConditionChips.map(({ label, field }) => (
                    <label key={field}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${draftOral[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                      <input type="checkbox" checked={!!draftOral[field]}
                        onChange={(e) => setDraftOral((prev) => ({ ...prev, [field]: e.target.checked }))}
                        className="w-4 h-4 rounded accent-primary" />
                      {label}
                    </label>
                  ))}
                  <button type="button" onClick={() => setOthersOralOpen((v) => !v)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-colors ${othersOralOpen || draftOral.others ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${othersOralOpen || draftOral.others ? 'bg-primary border-primary' : 'border-gray-600'}`}>
                      {(othersOralOpen || draftOral.others) && <Check className="w-3 h-3 text-white" />}
                    </span>
                    Others
                  </button>
                </div>
                {othersOralOpen && (
                  <div className="mt-3 rounded-lg bg-canvas p-3">
                    <label className="block text-xs font-bold text-foreground mb-1">Specify Other</label>
                    <input type="text" value={draftOral.others}
                      onChange={(e) => setDraftOral((prev) => ({ ...prev, others: e.target.value }))}
                      placeholder="Specify other oral condition…"
                      className="w-full text-xs border border-border rounded px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                )}
              </div>

              <div className={`border-t border-border pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:border-border lg:pl-4 ${editingChart ? '' : 'opacity-60 pointer-events-none select-none'}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="text-sm font-bold text-primary uppercase tracking-wide">Treatments Given</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Date treated
                    <input type="date" value={draftVisitDate}
                      onChange={(e) => setDraftVisitDate(e.target.value)}
                      className="border border-border rounded px-2 py-1 text-xs bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {serviceChips.map(({ label, field }) => (
                    <label key={field}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${draftServices[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                      {/* Unticking writes null, not false — see the state above. */}
                      <input type="checkbox" checked={draftServices[field] === true}
                        onChange={(e) => setDraftServices((prev) => ({ ...prev, [field]: e.target.checked ? true : null }))}
                        className="w-4 h-4 rounded accent-primary" />
                      {label}
                    </label>
                  ))}
                </div>
                {/* Unlocked 2026-09-25 -- ticking a service here now creates the
                    RPC visit on save (Visit 1 or 2, whichever this school year
                    doesn't have yet) instead of requiring one to already exist.
                    Shown only pre-save so it doesn't linger once the visit is
                    real; hidden once both visits already exist elsewhere this
                    year, since saving here would then have nowhere left to
                    record a third. */}
                {!linkedVisitForCard && (() => {
                  const used = new Set(Object.values(currentYearData?.preventiveByChart ?? {}).map((v) => v.visit_number));
                  const next = !used.has(1) ? 1 : !used.has(2) ? 2 : null;
                  return next ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Recording a service here creates this school year's next RPC visit (Visit {next}) when you save.
                    </p>
                  ) : null;
                })()}
              </div>
            </div>


            {/* Sprint 148 — one row per charting recorded this school year.
                Hidden when there is only one: a picker with a single option is
                noise. The dentist screens and treats at the same visit, so each
                charting is that visit's findings AND treatments, read on its
                own — they are never merged. */}
            {currentYearData && currentYearData.charts.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Charting:</span>
                {currentYearData.charts.map((c, i) => {
                  const isOn = currentYearData.dentalChart?._id === c._id;
                  const teeth = currentYearData.toothRecordsByChart[c._id]?.length ?? 0;
                  return (
                    <button
                      key={c._id}
                      onClick={() => setSelectedChartId(c._id)}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${isOn ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:bg-gray-50'}`}
                      title={`${teeth} tooth record${teeth === 1 ? '' : 's'}`}
                    >
                      {formatDate(c.date_charted)}
                      {/* A charting made from Record Visit knows its visit; one
                          made here, or before Sprint 149, shows the date alone
                          rather than a guessed visit number. */}
                      {currentYearData.visitNumberByChart[c._id] && (
                        <span className="ml-1 opacity-70">· Visit {currentYearData.visitNumberByChart[c._id]}</span>
                      )}
                      {i === currentYearData.charts.length - 1 && <span className="ml-1 opacity-70">· latest</span>}
                    </button>
                  );
                })}
                <span className="text-xs text-muted-foreground">
                  {currentYearData.charts.length} chartings this school year
                </span>
              </div>
            )}

            {/* ⚠ Sprint 152 — the palette is HIDDEN in view mode rather than
                shown greyed out, adopted from the collaborator's layout. It was
                already `pointer-events-none` when not editing, so it occupied
                the top of the screen doing nothing while the summaries above
                are what a dentist actually reads. The words moved to Legend.
                It reappears, unchanged, the moment Edit Chart is pressed. */}
            {/* ── THE PALETTE (Sprint 156) ────────────────────────────────
                Her chairside layout: code-only pills, the words in the Legend,
                the rare codes collapsed, and each "Applying…" banner under the
                palette it came from rather than once at the foot of the card —
                picking a treatment on the right used to light a message on the
                far left. Clear All moved onto the heading row and disappears
                when there is nothing to clear; a permanently-visible disabled
                destructive button is noise on a blank chart. */}
            {/* ⚠ Sprint 163 REVERSES Sprint 152. I hid this whole card in view
                mode; hers shows it GREYED with the hint below, and hers is
                right for this screen — a dentist opening a record sees what can
                be charted and that they are not in edit mode yet, instead of a
                palette that only exists after a click they have no reason to
                expect. The `pointer-events-none` is what makes it honest. */}
            <div className={`bg-blue-50 rounded-xl p-4 ${!editingChart ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              {!canEdit && <p className="text-xs text-muted-foreground mb-2 italic">View only — editing restricted to Dentist</p>}
              {canEdit && !editMode && <p className="text-xs text-muted-foreground mb-2 italic">View mode — click the pencil icon above to record conditions/treatments</p>}
              <div className={`grid grid-cols-1 ${iptrContext === 'default' ? 'lg:grid-cols-2' : ''} gap-4`}>
                {iptrContext !== 'treatment' && (
                <div className={iptrContext === 'default' ? 'lg:pr-4' : undefined}>
                  <div className="flex items-center justify-between gap-2 mb-2 min-h-[26px]">
                    <div className="text-sm font-bold text-primary uppercase tracking-wide">Condition Codes</div>
                    {chartedConditionCount > 0 && (
                      <button onClick={() => setConfirmClear('condition')}
                        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-all hover:border-red-400 hover:text-destructive">
                        <Trash2 className="h-3 w-3" /> Clear All ({chartedConditionCount})
                      </button>
                    )}
                  </div>
                  {/* "More" is the last item IN the same wrap row, so the rare
                      four read as a continuation of the palette rather than as
                      a separate control below it. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {commonConditionCodes.map((c) => (
                      <button key={c.code} title={c.label}
                        onClick={() => { setSelectedCondition(selectedCondition === c.code ? null : c.code); setSelectedTreatment(null); }}
                        className={`h-9 w-[60px] shrink-0 rounded-md border text-center transition-all flex items-center justify-center ${selectedCondition === c.code ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                        <span className="text-xs font-bold font-mono leading-none">{c.perm}/{c.temp}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => setRareConditionsOpen((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                      {rareConditionsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      More ({rareConditionCodes.length})
                    </button>
                  </div>
                  {rareConditionsOpen && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rareConditionCodes.map((c) => (
                        <button key={c.code} title={c.label}
                          onClick={() => { setSelectedCondition(selectedCondition === c.code ? null : c.code); setSelectedTreatment(null); }}
                          className={`h-9 w-[60px] shrink-0 rounded-md border text-center transition-all flex items-center justify-center ${selectedCondition === c.code ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                          <span className="text-xs font-bold font-mono leading-none">{c.perm}/{c.temp}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedCondition && (() => {
                    const c = conditionCodes.find((x) => x.code === selectedCondition);
                    return (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-teal-100 text-teal-800">
                          Applying: {c?.perm}/{c?.temp} ({c?.label}). Click teeth to apply.
                        </span>
                        <button onClick={() => setSelectedCondition(null)} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                      </div>
                    );
                  })()}
                </div>
                )}
                {iptrContext !== 'dental-queue' && (
                // Conditions and treatments are different vocabularies -- one
                // records what IS, the other what was DONE -- but unselected
                // buttons in both groups look identical, so without a rule the
                // two grids read as one long palette. Divider only when both
                // are on screen: side by side from lg, stacked below it.
                <div className={iptrContext === 'default' ? 'border-t border-border pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-4' : undefined}>
                  <div className="flex items-center justify-between gap-2 mb-2 min-h-[26px]">
                    <div className="text-sm font-bold text-primary uppercase tracking-wide">Treatment Codes</div>
                    {chartedTreatmentCount > 0 && (
                      <button onClick={() => setConfirmClear('treatment')}
                        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-all hover:border-red-400 hover:text-destructive">
                        <Trash2 className="h-3 w-3" /> Clear All ({chartedTreatmentCount})
                      </button>
                    )}
                  </div>
                  {/* The treatments that happen TO A TOOTH lead. ⚠ The three
                      whole-mouth services are behind "More", NOT removed as
                      they are on her branch: they are recorded on the RPC visit
                      now (Sprint 147), but the palette has always allowed them
                      on a tooth and old chartings carry them. Dropping them
                      would leave an existing FV on tooth 16 with no way to
                      change or clear it. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {perToothTreatmentCodes.map((t) => (
                      <button key={t.code} title={treatmentLabel(t)}
                        onClick={() => { setSelectedTreatment(selectedTreatment === t.code ? null : t.code); setSelectedCondition(null); }}
                        className={`h-9 w-[60px] shrink-0 rounded-md border text-center transition-all flex items-center justify-center ${selectedTreatment === t.code ? 'bg-blue-600 text-white ring-2 ring-blue-300 border-blue-600' : 'bg-card border-border text-foreground hover:border-blue-400'}`}>
                        <span className="text-xs font-bold font-mono leading-none">{t.code}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => setRareTreatmentsOpen((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      {rareTreatmentsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      More ({wholeMouthTreatmentCodes.length})
                    </button>
                  </div>
                  {rareTreatmentsOpen && (
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-1.5">
                        {wholeMouthTreatmentCodes.map((t) => (
                          <button key={t.code} title={treatmentLabel(t)}
                            onClick={() => { setSelectedTreatment(selectedTreatment === t.code ? null : t.code); setSelectedCondition(null); }}
                            className={`h-9 w-[60px] shrink-0 rounded-md border text-center transition-all flex items-center justify-center ${selectedTreatment === t.code ? 'bg-blue-600 text-white ring-2 ring-blue-300 border-blue-600' : 'bg-card border-border text-foreground hover:border-blue-400'}`}>
                            <span className="text-xs font-bold font-mono leading-none">{t.code}</span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        These describe the whole mouth. Record them under <strong>Treatments Given</strong> above, which is
                        what the DOH return counts; charting them on a tooth is kept for older records.
                      </p>
                    </div>
                  )}
                  {selectedTreatment && (() => {
                    const t = treatmentCodes.find((x) => x.code === selectedTreatment);
                    return (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">
                          Applying: {selectedTreatment} ({t?.label}). Click teeth to apply.
                        </span>
                        <button onClick={() => setSelectedTreatment(null)} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                      </div>
                    );
                  })()}
                </div>
                )}
              </div>
              {/* Without this the erase mode is folklore: the palette shows what
                  you are applying, but nothing said what a bare click does when
                  nothing is selected. */}
              {!selectedCondition && !selectedTreatment && (
                <div className="mt-3">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-muted text-foreground">
                    No code selected · Click teeth to clear
                  </span>
                </div>
              )}
            </div>

            <div className="relative bg-card rounded-xl border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)] p-4 overflow-x-auto">
              <div className="absolute top-0 left-0 right-0 h-1 bg-amber-600 z-10 rounded-t-xl" />
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

            {/* ⚠ The Treatment Code Counter is GONE (Sprint 177). Hers has no
                such block, and it was showing the same numbers twice: the
                Treatment Summary below carries a Tooth Count column per code,
                with the tooth NUMBERS beside it, which is the counter plus the
                part a dentist actually needs. Two read-outs of one figure is a
                chance for them to disagree and nothing more. */}
            {/* ── SUMMARIES (Sprint 151, moved to the foot of the tab in 155) ──
                Her page order, and it is the right one: these are READ-OUTS.
                They are read after the mouth is charted, so they follow the
                teeth instead of standing between the header and them.

                ⚠ Two tables because there are two kinds of answer — the
                distinction is hers. A whole-mouth finding is answered "is it
                present?"; a per-tooth treatment is only meaningful WITH the
                teeth it was done to, which a count alone never says.

                Hidden in charting mode for the same reason: a read-out is not
                a charting surface. */}
            {!chartingMode && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-teal-50/70 rounded-xl border border-teal-200 p-4 space-y-4">
                <div className="text-xs font-semibold text-teal-800 uppercase tracking-wide">Dental Condition Summary</div>

                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[63%]" /><col className="w-[37%]" /></colgroup>
                  <tbody>
                    <tr>
                      <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground">Date of Oral Examination</td>
                      <td className="border-b border-teal-200/70 px-2 py-1.5 font-semibold text-teal-800">
                        {draftChartDate ? formatDate(draftChartDate) : ''}
                      </td>
                    </tr>
                    {/* ⚠ BLANK ON PURPOSE, and it is her row, kept. "Orally Fit
                        Child" is a DOH IPTR field with a clinical definition —
                        caries-free or every caries treated, no debris, no gum
                        pathology — and the last of those is a judgement no
                        field of ours records. Deriving it from the teeth would
                        publish a clinical verdict the dentist never gave. The
                        row stays because a missing row is a different form; the
                        cell stays empty until there is something real in it. */}
                    <tr>
                      <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground">
                        Orally Fit Child
                        <span className="ml-1 text-muted-foreground">— not recorded</span>
                      </td>
                      <td className="border-b border-teal-200/70 px-2 py-1.5" />
                    </tr>
                    {presentOralConditions.map(({ label, present }) => (
                      <tr key={label}>
                        <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground">{label}</td>
                        <td className="border-b border-teal-200/70 px-2 py-1.5 font-semibold text-teal-800">
                          {present ? 'Yes' : ''}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground">Others</td>
                      <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground break-words">{draftOral.others}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Section B of the paper IPTR, verbatim rows and order. Every
                    figure is DERIVED from the teeth above — none of it is
                    typed, so it cannot disagree with the odontogram. */}
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[45%]" /><col className="w-[18%]" /><col className="w-[37%]" /></colgroup>
                  <thead>
                    <tr className="text-left text-teal-800">
                      <th className="border-b border-teal-200/70 px-2 py-1.5 font-semibold">Indicate Number</th>
                      <th className="border-b border-teal-200/70 px-2 py-1.5 font-semibold">Tooth Count</th>
                      <th className="border-b border-teal-200/70 px-2 py-1.5 font-semibold">Tooth Numbers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indicateNumberRows.map(({ label, teeth }) => (
                      <tr key={label}>
                        <td className="border-b border-teal-200/70 px-2 py-1.5 text-foreground">{label}</td>
                        <td className="border-b border-teal-200/70 px-2 py-1.5 font-semibold text-foreground">
                          {teeth.length ? teeth.length : ''}
                        </td>
                        <td className="border-b border-teal-200/70 px-2 py-1.5 font-mono text-foreground break-words">
                          {teeth.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-blue-50/70 rounded-xl border border-blue-200 p-4 space-y-4">
                <div className="text-xs font-semibold text-primary uppercase tracking-wide">Treatment Summary</div>

                {/* The whole-mouth services, as their OWN rows above the
                    per-tooth table — her split, adopted in full this time.
                    Sprint 151 refused these rows because hers read fields she
                    had added to DENTAL_CHART; they read the RPC visit here, so
                    there is still exactly one home for "was fluoride varnish
                    given" and it is the one the DOH return counts. */}
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[63%]" /><col className="w-[37%]" /></colgroup>
                  <tbody>
                    <tr>
                      <td className="border-b border-blue-200/70 px-2 py-1.5 text-foreground">Date of Treatment</td>
                      <td className="border-b border-blue-200/70 px-2 py-1.5 font-semibold text-primary">
                        {draftVisitDate ? formatDate(draftVisitDate) : ''}
                      </td>
                    </tr>
                    {serviceChips.map(({ label, field }) => (
                      <tr key={field}>
                        <td className="border-b border-blue-200/70 px-2 py-1.5 text-foreground">{label}</td>
                        {/* Blank for null AND for false: null is "not recorded"
                            and there is no tick for "withheld" on the paper
                            form either. Only a real Yes prints. */}
                        <td className="border-b border-blue-200/70 px-2 py-1.5 font-semibold text-primary">
                          {draftServices[field] === true ? 'Yes' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[45%]" /><col className="w-[18%]" /><col className="w-[37%]" /></colgroup>
                  <thead>
                    <tr className="text-left text-primary">
                      <th className="border-b border-blue-200/70 px-2 py-1.5 font-semibold">Treatment</th>
                      <th className="border-b border-blue-200/70 px-2 py-1.5 font-semibold">Tooth Count</th>
                      <th className="border-b border-blue-200/70 px-2 py-1.5 font-semibold">Tooth Numbers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perToothTreatmentRows.map((t) => {
                      const teeth = treatmentTeeth[t.code] ?? [];
                      return (
                        <tr key={t.code}>
                          <td className="border-b border-blue-200/70 px-2 py-1.5 text-foreground">
                            <span className="font-semibold mr-1">{t.code}</span>
                            {t.label}
                          </td>
                          <td className="border-b border-blue-200/70 px-2 py-1.5 font-semibold text-foreground">
                            {teeth.length ? teeth.length : ''}
                          </td>
                          <td className="border-b border-blue-200/70 px-2 py-1.5 font-mono text-foreground break-words">
                            {teeth.join(', ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            </div>
          </div>
        )}

        {/* ── TAB 4: Dental Records (DMFT History) ── */}
        {activeTab === 'records' && <DmftHistoryTab years={years} />}

        {/* ── TAB 5: Treatment History ── */}
        {activeTab === 'treatments' && (
          <TreatmentHistoryTab
            treatments={allTreatments}
            dentistNameById={dentistNameById}
            schoolYear={currentYearData?.iptr.school_year}
            canEdit={canEdit}
            staffNameLabel={staffNameLabel}
            staffName={user?.name ?? ''}
            addForm={{
              open: showAddTreatment,
              setOpen: setShowAddTreatment,
              values: treatmentForm,
              setValues: setTreatmentForm,
              error: treatmentError,
              saving: treatmentSaving,
              onSave: handleAddTreatment,
            }}
          />
        )}

        {/* ── TAB 6: Referrals (Sprint 127) -- REFERRAL exists now, so this is
             a real record rather than the "not tracked" placeholder it was.
             Issue-only by design: a referral is recorded when it is written,
             and nothing here pretends to know whether the family went. ── */}
        {activeTab === 'referrals' && (
          <ReferralsTab
            referrals={allReferrals}
            schoolYear={currentYearData?.iptr.school_year}
            canEdit={canEdit}
            addForm={{
              open: showAddReferral,
              setOpen: setShowAddReferral,
              values: referralForm,
              setValues: setReferralForm,
              error: referralError,
              saving: referralSaving,
              onSave: handleAddReferral,
            }}
          />
        )}

      {/* Chart legend (Sprint 152). Adopted from the collaborator's design;
          the content is OUR code lists, so it cannot drift from the palette
          the dentist actually clicks. */}
      {legendOpen && (
        <Modal onClose={() => setLegendOpen(false)}>
          <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">Chart Legend</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Every code used on this chart. Upper-case marks a permanent tooth, lower-case the primary
                tooth in the same position.
              </p>
            </div>
            <button
              onClick={() => setLegendOpen(false)}
              aria-label="Close legend"
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-gray-100 hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Condition codes — per tooth
              </div>
              <div className="space-y-1">
                {conditionCodes.map((c) => (
                  <div key={c.code} className="flex items-center gap-3 text-sm">
                    {/* ⚠ The swatch reads `conditionColors` — the SAME map the
                        tooth cells render from (see the odontogram above), not a
                        colour typed here. A hand-typed swatch is how a legend
                        ends up describing a colour the chart no longer uses. */}
                    <span
                      className={`font-mono font-bold text-foreground text-xs w-16 shrink-0 text-center px-1.5 py-1 rounded border ${
                        conditionColors[c.perm] ?? 'bg-card border-border'
                      }`}
                    >
                      {c.perm}/{c.temp}
                    </span>
                    <span className="text-muted-foreground">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Treatment codes — per tooth
              </div>
              <div className="space-y-1">
                {treatmentCodes.map((t) => (
                  <div key={t.code} className="flex items-baseline gap-3 text-sm">
                    <span className="font-mono font-bold text-primary w-16 shrink-0">{t.code}</span>
                    <span className="text-muted-foreground">{treatmentLabel(t)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Recorded elsewhere, not on a tooth
              </div>
              {/* ⚠ Deliberately different from the collaborator's version. Hers
                  listed whole-mouth services as chips on this screen; ours are
                  recorded against the RPC VISIT (Sprint 147), so the legend
                  says where they live rather than implying they are charted
                  here. */}
              <p className="text-xs text-muted-foreground">
                Whole-mouth findings — gingivitis, periodontal disease, debris, calculus, abnormal growth,
                cleft lip/palate — are recorded once per school year under <strong>History &amp; Oral</strong>.
                The services given at a visit — oral screening, prophylaxis, fluoride varnish, hygiene
                instruction — are recorded against that visit in <strong>RPC Monitoring</strong>, which is what
                the DOH return counts.
              </p>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Scores</div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div><span className="font-mono font-bold text-foreground">DMFT</span> — permanent teeth Decayed + Missing + Filled</div>
                <div><span className="font-mono font-bold text-foreground">dmft</span> — primary teeth decayed + missing + filled</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

        {/* ── TAB 7: AI Risk ── */}
        {activeTab === 'ai' && <AiRiskTab />}
        </>
        )}
      </div>
      </div>{/* end recordRef — PDF capture region */}
      <ConfirmDialog
        open={confirmDeleteYear !== null}
        title={`Remove ${confirmDeleteYear !== null ? years[confirmDeleteYear]?.iptr.school_year ?? 'school year' : 'school year'}?`}
        message={
          <div className="space-y-3">
            <p>This archives the entire school year — its dental chart and medical, dietary, and oral-health records. A System Admin can restore it from the archive.</p>
            <div>
              <label htmlFor={yearPasswordField} className="block text-xs font-medium text-foreground mb-1">
                Confirm with your password
              </label>
              <input
                id={yearPasswordField}
                name={yearPasswordField}
                type="password"
                autoComplete="new-password"
                value={yearPassword}
                onChange={(e) => { setYearPassword(e.target.value); setYearPasswordError(null); }}
                disabled={deletingYear}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              {yearPasswordError && <p className="mt-1 text-xs text-destructive">{yearPasswordError}</p>}
            </div>
          </div>
        }
        confirmLabel="Remove year"
        busy={deletingYear}
        onConfirm={confirmDeleteYearNow}
        onCancel={() => { setConfirmDeleteYear(null); setYearPassword(''); setYearPasswordError(null); }}
      />
      {/* ── CONSENT CONFIRMATION (Sprint 169, hers) ────────────────────────
          Her dialog, and the reason for it is right: ticking "consent
          obtained" is a claim about a piece of PAPER, so the dialog shows the
          form that paper is, and the person ticking confirms against it.

          ⚠ The service list is OURS — `SERVICES` in ConsentForm.tsx,
          transcribed verbatim from the blank form supplied 2026-09-03, grade
          ranges and all. Hers is a paraphrase in sentence case. A paraphrase in
          the dialog and the real wording on the sheet is how someone confirms
          against a form that says something else. */}
      {confirmConsent && (
        <Modal onClose={() => setConfirmConsent(null)} maxWidth="max-w-[666px]">
          <div className="flex items-start gap-3 p-6 border-b border-border">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${confirmConsent.revert ? 'bg-warning' : 'bg-primary'}`}>
              {confirmConsent.revert ? <ShieldAlert className="w-5 h-5 text-white" /> : <ShieldCheck className="w-5 h-5 text-white" />}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-primary mb-1">Guardian Consent</div>
              <h2 className="text-lg font-bold text-foreground">
                {confirmConsent.revert ? 'Revert consent to pending?' : 'Confirm consent obtained'}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {confirmConsent.revert
                  ? `This says the signed copy for ${confirmConsent.schoolYear} is NOT on file after all.`
                  : `Confirm a signed physical copy of the form below is on file for ${confirmConsent.schoolYear} before continuing.`}
              </p>
            </div>
          </div>
          {!confirmConsent.revert && (
            <div className="p-6 pb-0">
              <div className="rounded-lg border border-border bg-canvas p-4 max-h-64 overflow-y-auto text-xs text-foreground space-y-3">
                <p className="font-bold text-sm">Parents/Guardian Consent Form</p>
                <p className="text-muted-foreground">
                  Ang dentista po ng ating school clinic ay magsasagawa ng serbisyong dental sa mga mag-aaral na may
                  layuning makapagbigay ng preventive at curative treatment. Ang mga serbisyo dental ay ang mga sumusunod:
                </p>
                <ul className="space-y-2">
                  {CONSENT_SERVICES.map((sv) => (
                    <li key={sv.label}>
                      <span className="font-semibold">{sv.label}</span>
                      {sv.note && <span className="block text-muted-foreground">{sv.note}</span>}
                    </li>
                  ))}
                </ul>
                <p className="pt-2 border-t border-border font-medium">
                  Oo, pumapayag ako na bigyan ng serbisyong dental ang aking anak/apo/pamangkin.
                </p>
              </div>
            </div>
          )}
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg bg-warning-surface p-3">
              <ShieldIcon className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
              {/* ⚠ Worded to be TRUE. Hers says the tick "cannot be undone" and
                  hides the box once complete. Ours can be reverted — the model
                  hook clears `consent_given_at` on the way back, and that path
                  exists precisely so a mis-tick can be corrected without a
                  database edit. Saying "cannot be undone" when it can is the
                  same class of untruth as a control that only looks like it
                  works, so the wording follows the behaviour. */}
              <p className="text-xs text-warning">
                {confirmConsent.revert
                  ? 'The recorded consent date for this school year will be cleared.'
                  : `This records consent for ${confirmConsent.schoolYear} only, and stamps the date. It can be reverted here, which clears that date.`}
              </p>
            </div>
          </div>
          <div className="flex gap-3 p-6 pt-0">
            <button onClick={() => setConfirmConsent(null)}
              className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">
              Cancel
            </button>
            <button
              onClick={() => { const revert = confirmConsent.revert; setConfirmConsent(null); handleToggleConsent(!revert); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium ${confirmConsent.revert ? 'bg-warning hover:opacity-90' : 'bg-primary hover:bg-primary-hover'}`}
            >
              <Check className="w-4 h-4" /> {confirmConsent.revert ? 'Revert to pending' : 'Confirm consent'}
            </button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={pendingNav !== null}
        title="Leave this chart unsaved?"
        message={`Nothing on this chart has been saved yet. Going to ${pendingNav?.name ?? 'the next student'} discards it. Cancel, then use Save Chart if you want to keep it.`}
        confirmLabel="Discard and continue"
        onConfirm={() => { const t = pendingNav; setPendingNav(null); setEditMode(false); if (t) navigate(`/dental-chart/${t.id}`); }}
        onCancel={() => setPendingNav(null)}
      />
      <ConfirmDialog
        open={confirmClear !== null}
        title={confirmClear === 'treatment' ? `Clear all ${chartedTreatmentCount} treatments?` : `Clear all ${chartedConditionCount} conditions?`}
        message={`This removes every ${confirmClear === 'treatment' ? 'treatment code' : 'condition code'} on this chart, leaving the ${confirmClear === 'treatment' ? 'conditions' : 'treatments'} untouched. Nothing is saved until you click Save Chart — Cancel Edit still discards it.`}
        confirmLabel={confirmClear === 'treatment' ? 'Clear treatments' : 'Clear conditions'}
        onConfirm={() => confirmClear && clearAll(confirmClear)}
        onCancel={() => setConfirmClear(null)}
      />
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
