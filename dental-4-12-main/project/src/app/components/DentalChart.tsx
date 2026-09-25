import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, ChevronLeft, ChevronRight, Shield, Users, FileText, Plus, Pencil, Trash2, Download, X, Maximize2, Minimize2, Check, ChevronUp, ChevronDown, ShieldCheck, ShieldAlert, Shield as ShieldIcon, MoreVertical, AlertTriangle } from 'lucide-react';
import { buildPagesPdf } from '../utils/exportPdf';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { PreviewModal } from './PreviewModal';
import { getGradeColor } from '../utils/gradeColors';
import { BMI_NOTE } from '../utils/bmi';
import { useAuth } from '../context/AuthContext';
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
import { emptyMed, medDraftFrom, emptyDiet, emptyOral, type MedicalHistoryDraft, type DietDraft, type OralDraft } from './iptrDrafts';
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
  treatmentLabel,
  type ChartEntry,
} from '../utils/dentalChartCodes';

// REFERRAL_TYPE_LABELS moved to ReferralsTab.tsx with the panel that owns it
// (Sprint 162c). ⚠ A second copy still lives in Reports.tsx and the two have
// DRIFTED — see BUG-14.

// Capped at 11 (2026-09-25) -- matching GRADES' own 11 levels (Kinder
// through Grade 10), the longest a pupil is ever enrolled here. Add Year
// naturally stops once ALL_SCHOOL_YEARS is exhausted (see getNextSchoolYear),
// so extending this list is also how the cap would ever need to move.
const ALL_SCHOOL_YEARS = ['2023-2024', '2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029', '2029-2030', '2030-2031', '2031-2032', '2032-2033', '2033-2034'];
const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

// The draft shapes and their empty factories moved to `iptrDrafts.ts` in
// Sprint 162c — shared by this host, the History tab and the Dental Chart tab.

const formatDateStamp = (dateString?: string | null) => formatDate(dateString, 'No date stamp');

// A school year's date stamp IS its Oral Conditions "Date examined" (user,
// 2026-09-25): DENTAL_CHART.date_charted, shown only while an oral condition
// is recorded, so the chip and the field can never disagree. Replaces the
// separate "Edit date" menu item.
const examinedDate = (
  oc: { debris?: boolean; gingivitis?: boolean; calculus?: boolean; periodontal_disease?: boolean; cleft_lip_palate?: boolean; abnormal_growth?: boolean; others?: string } | null | undefined,
  chart: { date_charted?: string } | null | undefined,
): string | null => {
  const examined = !!oc && (oc.debris || oc.gingivitis || oc.calculus || oc.periodontal_disease || oc.cleft_lip_palate || oc.abnormal_growth || !!oc.others?.trim());
  return examined && chart?.date_charted ? chart.date_charted : null;
};

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
// ⚠ One of her chips is still NOT here: a free-text "Others". No field on
// PREVENTIVE_CARE_RECORD, and a checkbox that saves nowhere is exactly the
// placeholder CLAUDE.md forbids. `oral_hygiene_instruction` is ours and hers
// has no chip for it. "Consultation" WAS in this category too (needed the
// dentist's word on what it means for the DOH return) -- added 2026-09-25 per
// the user, tracked on the visit record but deliberately not printed on the
// Target Client List, whose paper form has no Consultation column.
type ServiceField = 'oral_screening' | 'oral_prophylaxis' | 'fluoride_varnish' | 'oral_hygiene_instruction' | 'consultation';
const serviceChips: { label: string; field: ServiceField }[] = [
  { label: 'Oral Examination', field: 'oral_screening' },
  { label: 'Fluoride Varnish', field: 'fluoride_varnish' },
  { label: 'Oral Prophylaxis', field: 'oral_prophylaxis' },
  { label: 'Oral Hygiene Instruction', field: 'oral_hygiene_instruction' },
  { label: 'Consultation', field: 'consultation' },
];

// Palette buttons (user's pick "E", 2026-09-24, replacing the taller
// labeled "A"): small code-only buttons in the palette font (DejaVu Sans, see
// theme.css --font-palette). The meaning of the SELECTED code shows in the
// one "click teeth to apply" line under the row; the full label is also on
// each button's tooltip and in the Legend.
// Plain bold (user, 2026-09-24): regular read too light, bold plus a stroke too heavy.
const paletteBtn = 'h-10 min-w-[52px] shrink-0 rounded-md border px-3 text-center font-palette text-sm font-bold leading-none transition-all inline-flex items-center justify-center';
// ✓ reads the same permanent and temporary, so it shows once, not "✓/✓".
const conditionCodeText = (c: { perm: string; temp: string }) => (c.perm === c.temp ? c.perm : `${c.perm}/${c.temp}`);

// The form downloads (user, 2026-09-24): ONE solid "Download PDF" button in
// the primary blue (#273A78, the user's chosen shade) that opens a menu of the
// two forms (user's pick "3", icon "F"). The page icons are blue-themed too. `paper`/`letters` let the same page icon sit white on
// the red button and red on the white menu.
const PdfPageIcon = ({ paper, fold, letters, className = 'h-5 w-5' }: { paper: string; fold: string; letters: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
    <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={paper} />
    <path d="M15 2v5h5" fill={fold} />
    <text x="12" y="17.3" fontSize="6.3" fontWeight="800" fill={letters} textAnchor="middle" fontFamily="inherit">PDF</text>
  </svg>
);

// Summary-card styles (option A, 2026-09-24): shared by the Dental Condition
// and Treatment Summary tables so the two cards cannot drift apart.
const sumCell = 'border-b border-slate-100 px-3 py-1.5 text-foreground';
const sumHead = 'bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-600 [&>th]:font-normal';
/** A two-word column heading: one line on wide screens (xl, 1280px+), and on narrower
 *  ones always the SAME two-line break ("Tooth" / "Count"), so every such
 *  heading wraps alike instead of wherever the width happens to cut it.
 *  xl, not lg: at 1024-1279px the narrower Dental Condition card has too
 *  little room for "TOOTH COUNT" on one line. */
const TwoWord = ({ a, b }: { a: string; b: string }) => (
  <><span className="block xl:inline">{a}</span>{' '}<span className="block xl:inline">{b}</span></>
);
const yesBadge = 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800';
/** Tooth numbers as small tags; wraps onto more lines when there are many. */
const ToothTags = ({ teeth, tone }: { teeth: number[]; tone: 'teal' | 'blue' }) => (
  <span className="flex flex-wrap gap-1">
    {teeth.map((n) => (
      <span key={n} className={`rounded px-1.5 py-px text-[10.5px] font-normal ${tone === 'teal' ? 'bg-teal-100 text-teal-800' : 'bg-blue-100 text-blue-900'}`}>{n}</span>
    ))}
  </span>
);

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
    { key: 'referrals', label: 'Notes & Referrals' },
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
  // Chart-specific save blocker (a tooth with a treatment but no condition).
  // Shown between the code palette and the odontogram, where the fix is made,
  // instead of in the header strip far above it (user, 2026-09-24).
  const [chartError, setChartError] = useState<string | null>(null);
  // The Download PDF menu in the header. Declared up here with the other hooks:
  // the header renders after the loading/error early returns.
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pdfMenuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!pdfMenuRef.current?.contains(e.target as Node)) setPdfMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPdfMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pdfMenuOpen]);

  const [editingInfo, setEditingInfo] = useState(false);
  const [draftInfo, setDraftInfo] = useState<Partial<typeof student>>({});
  // Height and weight live on the SELECTED YEAR's IPTR, not on STUDENT, so they
  // are drafted separately even though they share the one Edit button — the
  // save below writes to both records (Sprint 68).
  const [draftYear, setDraftYear] = useState<{ height_cm: string; weight_kg: string; grade_level: string; section: string }>({ height_cm: '', weight_kg: '', grade_level: '', section: '' });
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoMissing, setInfoMissing] = useState<Set<string>>(new Set());
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
  // Visit 1 / Visit 2 on Treatments Given (2026-09-25, reworked same day):
  // both visits share ONE dental chart now instead of each getting its own —
  // "there should be an indication like (V1)/(V2)" on the teeth themselves,
  // not two separate chartings. `activeVisit` picks which visit's SERVICES
  // are being viewed/edited and which visit number gets tagged onto any
  // tooth charted while it's selected; it does NOT change which chart or
  // tooth records are shown (there's only ever the one).
  const visit1 = currentYearData?.preventivesByVisitNumber?.[1];
  const visit2 = currentYearData?.preventivesByVisitNumber?.[2];
  const [explicitVisit, setExplicitVisit] = useState<1 | 2 | null>(null);
  // No explicit pick yet — default to Visit 2 once Visit 1 is recorded and
  // Visit 2 isn't: the next thing to do, not a re-read of what's already
  // recorded.
  const activeVisit: 1 | 2 = explicitVisit ?? (visit1 && !visit2 ? 2 : 1);
  const activeVisitRecord = activeVisit === 1 ? visit1 : visit2;

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
    oral_screening: null, oral_prophylaxis: null, fluoride_varnish: null, oral_hygiene_instruction: null, consultation: null,
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

  useEffect(() => {
    if (!currentYearData) {
      setDraftChart({});
      setDraftMed(emptyMed());
      setDraftDiet(emptyDiet());
      setDraftOral(emptyOral());
      setOthersOralOpen(false);
      setDraftMeasure({ height_cm: '', weight_kg: '', temperature_c: '', blood_pressure: '' });
      setDraftServices({ oral_screening: null, oral_prophylaxis: null, fluoride_varnish: null, oral_hygiene_instruction: null, consultation: null });
      setDraftVisitDate('');
      setDraftChartDate('');
      setEditMode(false);
      return;
    }
    const chart: Record<number, ChartEntry> = {};
    for (const tr of currentYearData.toothRecords) {
      chart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '', visitNumber: tr.visit_number ?? null };
    }
    setDraftChart(chart);

    const mh = currentYearData.medicalHistory;
    setDraftMed(mh ? medDraftFrom(mh) : emptyMed());

    const dh = currentYearData.dietaryHabits;
    setDraftDiet(dh ? {
      sugarSweetened: dh.sugar_beverages, alcoholDrinker: dh.alcohol_drinker, tobaccoUser: dh.tobacco_user,
      betelNut: dh.betel_nut_chewer, bodyPiercing: dh.body_piercing, nailBiting: dh.nail_biting, thumbsucking: dh.thumb_sucking,
    } : emptyDiet());

    const examined = examinedDate(currentYearData.oralCondition, currentYearData.dentalChart);
    setDraftChartDate(examined ? new Date(examined).toISOString().slice(0, 10) : '');
    setDraftMeasure({
      height_cm: currentYearData.iptr.height_cm != null ? String(currentYearData.iptr.height_cm) : '',
      weight_kg: currentYearData.iptr.weight_kg != null ? String(currentYearData.iptr.weight_kg) : '',
      temperature_c: currentYearData.iptr.temperature_c != null ? String(currentYearData.iptr.temperature_c) : '',
      blood_pressure: currentYearData.iptr.blood_pressure ?? '',
    });
    const oc = currentYearData.oralCondition;
    setDraftOral(oc ? {
      gingivitis: oc.gingivitis, periodontal: oc.periodontal_disease, debris: oc.debris, calculus: oc.calculus,
      abnormalGrowth: oc.abnormal_growth, cleftLipPalate: oc.cleft_lip_palate,
      oralHygiene: oc.oral_hygiene, others: oc.others,
    } : emptyOral());
    // "Others" is ticked (box open) whenever there is already text to show,
    // not just when the dentist just clicked it this session -- otherwise a
    // record with real "others" text loaded with the box hidden and the chip
    // looking ticked from `draftOral.others` alone, one state describing two
    // different things.
    setOthersOralOpen(!!oc?.others);

    // Empty year (nothing recorded yet) exists to be filled — drop clinical
    // staff straight into edit mode; anything with data opens as a read view.
    setEditMode(
      (user?.role === 'dentist' || user?.role === 'dental_aide') &&
      !currentYearData.medicalHistory && !currentYearData.oralCondition &&
      currentYearData.toothRecords.length === 0,
    );
  }, [selectedYear, currentYearData, user?.role]);

  // Treatments Given's services/date follow the ACTIVE VISIT, not the whole
  // draft-population effect above -- a SEPARATE effect on purpose, so
  // switching the Visit 1 / Visit 2 tab only refreshes the services card, not
  // in-progress unsaved teeth/history edits (which would be lost if this were
  // folded into the effect above, since that one fully re-syncs everything
  // from source data on every dependency change).
  useEffect(() => {
    const visit = activeVisitRecord;
    setDraftVisitDate(visit ? new Date(visit.visit_date).toISOString().slice(0, 10) : '');
    setDraftServices({
      oral_screening: visit?.oral_screening ?? null,
      oral_prophylaxis: visit?.oral_prophylaxis ?? null,
      fluoride_varnish: visit?.fluoride_varnish ?? null,
      oral_hygiene_instruction: visit?.oral_hygiene_instruction ?? null,
      consultation: visit?.consultation ?? null,
    });
  }, [activeVisitRecord]);

  // Effective edit rights: role AND edit mode. Aides keep read-only here —
  // they could tick history boxes before, but Save was always dentist-only,
  // so those edits silently went nowhere (dead UI, now honest).
  const editingChart = canEdit && editMode;
  // A picked code belongs to an editing session: leaving edit mode (Save,
  // Cancel, or a view-only role) drops it, so view mode never shows a
  // highlighted code or its "Click teeth to apply" hint.
  useEffect(() => {
    if (!editingChart) { setSelectedCondition(null); setSelectedTreatment(null); }
  }, [editingChart]);
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
  // Treatment Summary's Visit 1 / Visit 2 columns (2026-09-25) -- the shared
  // teethByTreatment function is untouched (IptrFormV2's printed Form 1 also
  // calls it, and the paper form has no visit split to show); this just
  // pre-filters its input by the tooth's visit_number tag before calling it,
  // twice. "Visit 1" is the catch-all (visit_number 1 AND untagged/legacy
  // teeth charted outside the visit flow), so nothing charted before this
  // feature existed silently disappears from the summary; "Visit 2" is
  // strictly visit_number 2.
  const treatmentTeethVisit1 = useMemo(
    () => teethByTreatmentCode(chartedTeeth.filter((t) => currentChart[t.tooth]?.visitNumber !== 2)),
    [chartedTeeth, currentChart],
  );
  const treatmentTeethVisit2 = useMemo(
    () => teethByTreatmentCode(chartedTeeth.filter((t) => currentChart[t.tooth]?.visitNumber === 2)),
    [chartedTeeth, currentChart],
  );
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
  // "Orally Fit Child" — AUTOMATIC. Rule (user, 2026-09-24): Yes ONLY when
  // teeth have been charted and EVERY charted tooth is Sound (✓), with none
  // of the oral conditions above present. An uncharted mouth is not "fit",
  // it is unexamined, so it stays blank. A treatment code on a sound tooth
  // (e.g. a sealant) does not block it: ✓ is the form's "Sound/Sealed".
  // Not stored anywhere; recomputed from the chart, so it can never drift.
  const isOrallyFitChild = useMemo(() => {
    // A tooth just emptied in the draft (no code at all) is not charted.
    const teeth = chartedTeeth.filter((t) => t.condition || t.treatment);
    return teeth.length > 0
      && teeth.every((t) => t.condition === '✓' || t.condition === '√')
      && !presentOralConditions.some((c) => c.present);
  },
    [presentOralConditions, chartedTeeth],
  );
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

  // Dates follow what is painted (user, 2026-09-24, replacing the earlier
  // "fill both dates, never overwrite" rule): applying a CONDITION code stamps
  // today on the oral-condition "Date examined"; applying a TREATMENT code
  // stamps today on the active visit's Treatments Given date. Toggling a code
  // off or erasing a tooth changes no date.
  const stampConditionDate = () => setDraftChartDate(toLocalDateString(new Date()));
  const stampTreatmentDate = () => setDraftVisitDate(toLocalDateString(new Date()));

  // "Date examined" tracks whether ANY oral condition chip (Others included)
  // is currently ticked (2026-09-25) -- auto-filled with today the moment
  // the first one is, cleared back to blank the moment the last one is
  // unticked. Takes the post-toggle values directly rather than reading
  // state back after setDraftOral/setOthersOralOpen, which would still be
  // last render's values inside the same event handler.
  const syncChartDateFromConditions = (oral: OralDraft, othersOpen: boolean) => {
    const anyTicked = oralConditionChips.some(({ field }) => oral[field]) || othersOpen;
    setDraftChartDate(anyTicked ? (draftChartDate || toLocalDateString(new Date())) : '');
  };
  // Same rule for "Date treated" against the Treatments Given chips.
  const syncVisitDateFromServices = (services: Record<ServiceField, boolean | null>) => {
    const anyTicked = serviceChips.some(({ field }) => services[field] === true);
    setDraftVisitDate(anyTicked ? (draftVisitDate || toLocalDateString(new Date())) : '');
  };

  // Paint-stroke state (2026-09-25) -- "hold and continuously mark": pressing
  // down on a tooth and dragging applies the same action to every tooth the
  // pointer passes over, like a paint tool, instead of one click per tooth.
  // The action (apply this code, or clear) is decided ONCE, from the tooth
  // the stroke started on -- exactly what a single click already decided --
  // and reapplied verbatim to every tooth the drag enters afterward. A later
  // tooth is never independently re-toggled, or half a stroke would paint on
  // and the other half paint off.
  const isPaintingRef = useRef(false);
  const paintActionRef = useRef<'condition' | 'treatment' | 'erase' | null>(null);
  const paintValueRef = useRef('');

  const applyToothPaint = (toothNumber: number, action: 'condition' | 'treatment' | 'erase', value: string) => {
    const isTemp = temporaryTeeth.has(toothNumber);
    if (action === 'condition') {
      const codeObj = conditionCodes.find((c) => c.code === value);
      const code = value ? (codeObj ? (isTemp ? codeObj.temp : codeObj.perm) : value) : '';
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: code, treatment: prev[toothNumber]?.treatment || '', visitNumber: activeVisit },
      }));
    } else if (action === 'treatment') {
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: prev[toothNumber]?.condition || '', treatment: value, visitNumber: activeVisit },
      }));
    } else {
      // No code selected: painting a tooth empties it. This used to be a dead
      // click, which meant the ONLY way to remove a code was to first hunt down
      // the matching code in the palette and click the tooth again — you had to
      // know what was already there to get rid of it.
      //
      // Clears BOTH condition and treatment on purpose: with neither brush
      // active the intent is "empty this tooth". Removing just one is still
      // possible the precise way — select that exact code and paint the tooth
      // to toggle it off. Nothing persists until Save Chart, and Cancel Edit
      // discards it.
      setDraftChart((prev) => ({
        ...prev,
        [toothNumber]: { condition: '', treatment: '', visitNumber: null },
      }));
    }
  };

  const handleToothPointerDown = (toothNumber: number) => {
    isPaintingRef.current = true;
    setChartError(null);
    if (selectedCondition) {
      const isTemp = temporaryTeeth.has(toothNumber);
      const codeObj = conditionCodes.find((c) => c.code === selectedCondition);
      const code = codeObj ? (isTemp ? codeObj.temp : codeObj.perm) : selectedCondition;
      const current = currentChart[toothNumber]?.condition;
      const value = current === code ? '' : selectedCondition;
      paintActionRef.current = 'condition';
      paintValueRef.current = value;
      if (value) stampConditionDate();
      applyToothPaint(toothNumber, 'condition', value);
    } else if (selectedTreatment) {
      const current = currentChart[toothNumber]?.treatment;
      const value = current === selectedTreatment ? '' : selectedTreatment;
      paintActionRef.current = 'treatment';
      paintValueRef.current = value;
      if (value) stampTreatmentDate();
      applyToothPaint(toothNumber, 'treatment', value);
    } else {
      paintActionRef.current = 'erase';
      paintValueRef.current = '';
      applyToothPaint(toothNumber, 'erase', '');
    }
  };

  const handleToothPointerEnter = (toothNumber: number) => {
    if (!isPaintingRef.current || !paintActionRef.current) return;
    applyToothPaint(toothNumber, paintActionRef.current, paintValueRef.current);
  };

  // Drag continuation needs a WINDOW-level listener, not onPointerEnter on
  // each tooth: touch does not fire pointerenter on the elements a finger
  // passes over (the browser keeps touch pointer events implicitly targeted
  // at the element the touch started on), so elementFromPoint at the
  // pointer's live position is what makes the drag itself work at a tablet or
  // phone width, not only with a mouse.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isPaintingRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const toothEl = el?.closest<HTMLElement>('[data-tooth]');
      const num = toothEl ? Number(toothEl.dataset.tooth) : NaN;
      if (!Number.isNaN(num)) handleToothPointerEnter(num);
    };
    const onUp = () => {
      isPaintingRef.current = false;
      paintActionRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [activeVisit]);

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
  const [confirmSaveInfo, setConfirmSaveInfo] = useState(false);
  // Save Changes is only live once something actually differs from the
  // record (user, 2026-09-25). Blank and missing count as the same value.
  const infoDirty = !!draftInfo && !!student && (
    (Object.keys(draftInfo) as (keyof typeof draftInfo)[]).some((k) => String(draftInfo[k] ?? '') !== String((student as any)[k] ?? ''))
    || draftYear.grade_level !== (years[selectedYear]?.iptr.grade_level ?? '')
    || draftYear.section !== (years[selectedYear]?.iptr.section ?? '')
  );
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
    setChartError(null);
    try {
      // Teeth are dentist-only (aides save History & Oral); the chart record
      // is only created when there are real tooth changes to persist — an
      // aide saving history must not require (or fabricate) a dentist chart.
      const existingByTooth = new Map(currentYearData.toothRecords.map((tr) => [tr.tooth_number, tr]));
      // ToothRecord.condition is required (non-empty) on the backend. A tooth
      // emptied completely (no condition, no treatment) is RETIRED: its saved
      // record is archived, never deleted (CLAUDE.md soft-delete rule). This
      // used to silently skip cleared teeth, so removing every code and saving
      // "succeeded" while the old codes came straight back on reload.
      // A tooth left with a treatment but no condition cannot be stored, so it
      // stops the save with a message instead of being dropped quietly.
      if (canEdit) {
        const orphaned = Object.entries(draftChart)
          .filter(([, entry]) => entry.condition === '' && entry.treatment !== '')
          .map(([toothStr]) => toothStr);
        if (orphaned.length) {
          const message = `Tooth ${orphaned.join(', ')} has a treatment but no condition. Add a condition or remove the treatment, then save.`;
          setChartError(message);
          toast.error(message);
          return;
        }
      }
      const clearedRecords = canEdit
        ? Object.entries(draftChart)
            .filter(([, entry]) => entry.condition === '' && entry.treatment === '')
            .map(([toothStr]) => existingByTooth.get(Number(toothStr)))
            .filter((tr): tr is NonNullable<typeof tr> => !!tr)
        : [];
      const pendingTeeth = canEdit
        ? Object.entries(draftChart)
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
      // A treatment charted on a tooth also opens the active visit (user,
      // 2026-09-24): the treatment is tagged with this visit's number, so the
      // visit it belongs to must exist even when no service is ticked.
      const chartsTreatment = pendingTeeth.some(([, entry]) => entry.treatment !== '');
      let chartId = currentYearData.dentalChart?._id;
      // A Date examined alone also opens the chart, since that is where the
      // date lives (and what the school-year stamp reads).
      if (!chartId && (pendingTeeth.length > 0 || hasAnyService || (!!draftChartDate && !!currentDentist))) {
        if (!currentDentist) throw new Error('No dentist record linked to your account.');
        const created = await apiClient.post<{ _id: string }>('/dental-charts', {
          iptr_id: currentYearData.iptr._id,
          dentist_id: currentDentist._id,
          date_charted: draftChartDate || toLocalDateString(new Date()),
        });
        chartId = created._id;
      }

      // visit_number tags which visit this tooth's CURRENT treatment belongs
      // to (2026-09-25) -- Visit 1 and Visit 2 share this one chart, so this
      // is what lets the odontogram and Treatment Summary show "(V1)"/"(V2)"
      // instead of the two visits' teeth work being indistinguishable.
      const toothWrites = pendingTeeth.map(([toothStr, entry]) => {
        const toothNumber = Number(toothStr);
        const existing = existingByTooth.get(toothNumber);
        const body = { chart_id: chartId, tooth_number: toothNumber, condition: entry.condition, treatment_code: entry.treatment, visit_number: activeVisit };
        return existing ? apiClient.put(`/tooth-records/${existing._id}`, body) : apiClient.post('/tooth-records', body);
      });
      toothWrites.push(...clearedRecords.map((tr) => apiClient.patch(`/tooth-records/${tr._id}/archive`)));

      // The draft already uses MEDICAL_HISTORY's field names (2026-09-24), so
      // it is sent as-is. `previous_surgical` used to be hard-coded false here.
      const medBody = { iptr_id: currentYearData.iptr._id, ...draftMed };
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

      // ── The active visit's services and date (Sprint 154; unlocked and
      //    reworked 2026-09-25) ────────────────────────────────────────────
      // Ticking a service here no longer requires an RPC visit to already
      // exist — it IS what creates one now, per the user's explicit
      // direction that RPC should be derived from the chart and never the
      // other way around. Visit 1 and Visit 2 are found directly by
      // visit_number on THIS iptr (preventivesByVisitNumber), independent of
      // chart linkage, since both visits now share one chart instead of each
      // getting their own.
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
      if (activeVisitRecord) {
        extraWrites.push(apiClient.put(`/preventive-care-records/${activeVisitRecord._id}`, {
          ...draftServices,
          ...(draftVisitDate ? { visit_date: draftVisitDate } : {}),
        }));
      } else if (hasAnyService || chartsTreatment) {
        extraWrites.push(apiClient.post('/preventive-care-records', {
          iptr_id: currentYearData.iptr._id,
          visit_date: draftVisitDate || draftChartDate || toLocalDateString(new Date()),
          visit_number: activeVisit,
          ...draftServices,
        }));
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
    setInfoMissing(new Set());
    setEditingInfo(true);
  };

  // Same required fields as Add New Student (PatientList REQUIRED_STUDENT_FIELDS,
  // user 2026-09-25): checked BEFORE the confirm step, so the dialog never
  // asks to save a form that would be refused.
  const requiredInfo = (d: typeof draftInfo) => [
    { key: 'last_name', label: 'Last Name', on: true },
    { key: 'first_name', label: 'First Name', on: true },
    { key: 'birthday', label: 'Birthdate', on: true },
    { key: 'sex', label: 'Sex', on: true },
    { key: 'grade_level', label: 'Grade', on: !d.is_not_student },
    { key: 'section', label: 'Section', on: !d.is_not_student },
    { key: 'fourps_id', label: '4Ps ID', on: !!d.is_4ps },
  ].filter((f) => f.on);
  // Red " *" only while the field is required right now (Grade/Section drop
  // it under "Not a Student"), and the per-field line after a refused save.
  const infoReq = (key: string) => requiredInfo(draftInfo).some((f) => f.key === key) ? <span className="text-destructive"> *</span> : null;
  const infoMiss = (key: string) => infoMissing.has(key) ? <p className="mt-1 text-xs text-destructive">This field is required.</p> : null;
  const handleSaveInfoClick = () => {
    if (!draftInfo) return;
    const missing = requiredInfo(draftInfo).filter(({ key }) => !String((draftInfo as Record<string, unknown>)[key] ?? '').trim());
    setInfoMissing(new Set(missing.map((m) => m.key)));
    if (missing.length) { setInfoError(`Please fill in: ${missing.map((m) => m.label).join(', ')}.`); return; }
    setInfoError(null);
    setConfirmSaveInfo(true);
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
      // No PhilHealth number means no PhilHealth status (user, 2026-09-24).
      await apiClient.put(`/students/${id}`, (draftInfo.philhealth_number ?? '').trim() ? draftInfo : { ...draftInfo, philhealth_status: 'None' });
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
        data-tooth={num}
        onPointerDown={() => editingChart && handleToothPointerDown(num)}
        // Keyboard activation only (Enter/Space on a focused tooth) -- a real
        // mouse/touch press is already fully handled by onPointerDown above,
        // and a plain click always follows a mouse's own pointerdown, so
        // acting on it here too would toggle the tooth right back. detail===0
        // is the standard tell for a keyboard-triggered click (no mouse click
        // count behind it) versus a pointer-triggered one.
        onClick={(e) => { if (e.detail === 0 && editingChart) handleToothPointerDown(num); }}
        // touch-action: none stops the browser from treating a chairside drag
        // across teeth as a page scroll, which is exactly what a paint stroke
        // looks like to a touchscreen otherwise.
        style={{ touchAction: 'none' }}
        // Grows to fill the card instead of leaving ~100px of slack on each
        // side, capped so the boxes stay tooth-shaped rather than becoming wide
        // rectangles on a large screen. flex-1 is also what keeps the primary
        // row aligned with the permanent one -- both rows are 16 equal slots.
        className={`relative flex h-[52px] min-w-[40px] max-w-[56px] flex-1 flex-col items-center justify-between rounded-md border-2 px-0.5 py-1 text-center transition-all md:h-[64px] ${colorClass} ${hoverClass}`}
      >
        <div className="text-[8px] font-medium text-slate-500 leading-none">{num}</div>
        {/* The sound-tooth check is drawn larger (user, 2026-09-24): at the
            letter codes' size it read as a speck next to D/M/F. */}
        {cond && <div className={`${cond === '✓' || cond === '√' ? 'text-base md:text-xl' : 'text-[11px] md:text-sm'} font-bold text-slate-700 leading-none`}>{cond}</div>}
        {/* Blue, not teal: the palette selects conditions in teal and
            treatments in blue, but this rendered the treatment code in the
            condition colour, crossing the two vocabularies on the teeth. */}
        {treat && <div className="text-[8px] md:text-[10px] font-semibold text-blue-700 leading-none">{treat}</div>}
        {/* Which visit this tooth's treatment was recorded at (2026-09-25) --
            now that Visit 1 and Visit 2 share one chart instead of each
            getting their own. Absent for teeth charted outside the visit
            flow (visitNumber null/undefined). */}
        {treat && (data?.visitNumber === 1 || data?.visitNumber === 2) && (
          // No parentheses, smaller, colour-coded (user, 2026-09-24): V1 amber,
          // V2 violet -- neither is used by the condition colours or the blue
          // treatment code above, so the tag never reads as either.
          <div className={`rounded-sm px-[3px] py-[1px] text-[5px] md:text-[7px] font-bold leading-none text-white ${data.visitNumber === 1 ? 'bg-amber-500' : 'bg-violet-600'}`}>
            {`V${data.visitNumber}`}
          </div>
        )}
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
          {/* Both forms are in use, so both are offered, and the menu says
              WHICH with a one-line description, instead of a single button
              silently picking one. */}
          <div ref={pdfMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setPdfMenuOpen((v) => !v)}
              disabled={pdfBusy}
              aria-haspopup="menu"
              aria-expanded={pdfMenuOpen}
              className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {pdfBusy ? 'Preparing…' : 'Download PDF'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pdfMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {pdfMenuOpen && (
              <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-50 w-[270px] rounded-xl border border-border bg-card p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
                {([
                  ['patient', 'IPTR', 'Individual Patient Treatment Record, 2 pages'],
                  ['form1', 'Form 1', 'Individual Treatment Record (DOH)'],
                ] as const).map(([which, name, desc]) => (
                  <button key={which} type="button" role="menuitem"
                    onClick={() => { setPdfMenuOpen(false); onIptrPdf(which); }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary-surface">
                    <PdfPageIcon paper="#273A78" fold="#8FA0CF" letters="#fff" className="mt-0.5 h-6 w-6" />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-foreground">{name}</span>
                      <span className="block text-[11px] text-muted-foreground">{desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="hidden sm:flex h-9 items-stretch rounded-lg border-2 border-sidebar-bg bg-white overflow-hidden">
            <button
              onClick={() => goToStudent(prevPatient)}
              disabled={!prevPatient}
              title={prevPatient ? `← ${prevPatient.name}` : undefined}
              className="flex items-center gap-1.5 px-3 text-xs font-semibold text-sidebar-bg hover:bg-primary-surface disabled:opacity-30 disabled:cursor-default border-r-2 border-sidebar-bg"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {/* Surname, not the given name: the list is ordered by surname,
                  so the button must name the same thing you are stepping through. */}
              {prevPatient ? <span className="max-w-[80px] truncate">{prevPatient.lastName || prevPatient.name}</span> : 'First'}
            </button>
            <span className="flex items-center gap-1 px-3 text-xs font-semibold text-sidebar-bg">
              <Users className="w-3 h-3" />
              {navIndex >= 0 ? `${navIndex + 1}/${navList.length}` : '—'}
            </span>
            <button
              onClick={() => goToStudent(nextPatient)}
              disabled={!nextPatient}
              title={nextPatient ? `${nextPatient.name} →` : undefined}
              className="flex items-center gap-1.5 px-3 text-xs font-semibold text-sidebar-bg hover:bg-primary-surface disabled:opacity-30 disabled:cursor-default border-l-2 border-sidebar-bg"
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
      <div className={`bg-card rounded-xl border-2 border-primary shadow-[0_8px_24px_rgba(15,23,42,0.08)] ${!basicInfoExpanded ? 'py-2 px-4' : 'p-4'}`}>
        {/* Editing opens the "Edit Basic Information" window below (user,
            2026-09-25), laid out like Add New Student; the card keeps showing
            the record behind it. */}
        {(
          <>
            <div className={`flex items-start justify-between ${basicInfoExpanded ? 'mb-3' : ''}`}>
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
                    {/* "Grade 3-Bunga" as plain text, no pill (user, 2026-09-24):
                        grade, dash and section all in the grade's colour-coding
                        colour (user, same day), same size, not bold. Same design as the
                        charting-mode header below. */}
                    {(yearGrade || yearSection) && (
                      <span className="whitespace-nowrap text-xs font-normal">
                        {yearGrade && <span style={{ color: getGradeColor(yearGrade).solid }}>{yearGrade}</span>}
                        {yearGrade && yearSection && <span style={{ color: getGradeColor(yearGrade).solid }}>-</span>}
                        {yearSection && <span style={yearGrade ? { color: getGradeColor(yearGrade).solid } : undefined} className={yearGrade ? undefined : 'text-foreground'}>{yearSection}</span>}
                      </span>
                    )}
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
                ['PhilHealth', student.philhealth_number ? `${student.philhealth_number} (${student.philhealth_status || 'None'})` : '—'],
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
                      className="flex items-center justify-center rounded-lg border border-destructive bg-destructive p-2 text-white transition-opacity hover:opacity-90">
                      <Pencil className="w-4 h-4" />
                    </button>
                  ) : (
                    <>
                      <button onClick={cancelEdit} disabled={saving} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60">
                        Cancel
                      </button>
                      <button onClick={handleSave} disabled={saving} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${saved ? 'bg-green-600 text-white' : 'bg-destructive text-white hover:opacity-90'}`}>
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
                // teeth recorded a day earlier. No records at all prints 0 (user, 2026-09-25; was "—").
                const yrChart: Record<number, ChartEntry> = {};
                for (const tr of y.dmftToothRecords ?? []) yrChart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
                const yrDmft = computeDMFT(yrChart);
                const yrDmftLabel = `${yrDmft.T + yrDmft.t}`; // 0 when nothing is charted (user, 2026-09-25)
                const isActive = selectedYear === idx;
                return (
                  <div key={y.iptr._id} className={`mr-1 flex flex-shrink-0 items-stretch border-b-2 ${isActive ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                    <button type="button" onClick={() => { setSelectedYear(idx); setSelectedChartId(null); setExplicitVisit(null); }} className="px-4 py-2.5 text-left text-xs font-medium transition-all">
                      <div>{y.iptr.school_year}</div>
                      {activeTab === 'chart' && (
                        <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'} >DMFT: {yrDmftLabel}</div>
                      )}
                      <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'}>
                        {formatDateStamp(examinedDate(y.oralCondition, y.dentalChart))}
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
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
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
        // Navy "Consent" title bar like the Dental Chart panels, applied in
        // full (user pick "D", 2026-09-25 — no separate coloured icon block;
        // the shield moves into a status pill next to the text).
        <div className="overflow-hidden rounded-xl border border-slate-300 bg-card">
        <div className="bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white">Consent</div>
        <div className="flex items-center gap-3 px-4 py-3 min-w-0">
          <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${consentComplete ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]' : 'border-[#FCD34D] bg-[#FFFBEB] text-[#B45309]'}`}>
            {consentComplete ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {consentComplete ? 'Obtained' : 'Pending'}
          </span>
          <div className="flex-1 flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0 flex flex-col justify-center gap-0.5">
              <div className="text-[13.5px] font-bold leading-tight text-foreground">
                {consentComplete
                  ? `Physical copy of consent obtained for ${yearIptr.school_year}`
                  : `Consent pending for ${yearIptr.school_year}`}
              </div>
              <div className="flex items-center gap-2 leading-tight">
                {/* Same plain "Grade 6-Rose" text as the patient card header,
                    all in the grade's colour-coding colour, no pill (user, 2026-09-24). */}
                {yearGrade ? (
                  <span className="whitespace-nowrap text-xs font-normal" style={{ color: getGradeColor(yearGrade).solid }}>
                    {yearGrade}{yearSection ? `-${yearSection}` : ''}
                  </span>
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
        </div>
      )}

      {/* Tab Content */}
      <div className="relative overflow-hidden bg-card rounded-xl border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        {/* Teal strip on every tab except Dental Chart, whose panels carry their own navy bars. */}
        {activeTab !== 'chart' && <div className="absolute top-0 left-0 right-0 h-1 bg-teal-600 z-10" />}

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
                  {(yearGrade || yearSection) && (
                    <span className="whitespace-nowrap text-xs font-normal">
                      {yearGrade && <span style={{ color: getGradeColor(yearGrade).solid }}>{yearGrade}</span>}
                      {yearGrade && yearSection && <span style={{ color: getGradeColor(yearGrade).solid }}>-</span>}
                      {yearSection && <span style={yearGrade ? { color: getGradeColor(yearGrade).solid } : undefined} className={yearGrade ? undefined : 'text-foreground'}>{yearSection}</span>}
                    </span>
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
                        className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${saved ? 'bg-green-600' : 'bg-destructive hover:opacity-90'}`}>
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
            {/* Navy title bar panels (user pick "G", 2026-09-25); the
                odontogram card below deliberately gets no bar. */}
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-card">
            {/* Grey while not editable (user, 2026-09-25): navy means "you can change this". */}
            <div className={`${editingHistory ? 'bg-primary' : 'bg-slate-400'} px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white`}>Oral Conditions &amp; Treatments Given</div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={editingHistory ? '' : 'opacity-60 pointer-events-none select-none'}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="text-sm font-bold text-primary uppercase tracking-wide">Oral Conditions</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Date examined
                    <input type="date" value={draftChartDate} disabled={!(oralConditionChips.some(({ field }) => draftOral[field]) || othersOralOpen)}
                      onChange={(e) => setDraftChartDate(e.target.value)}
                      title="Filled in when an oral condition is ticked"
                      className="border border-border rounded px-2 py-1 text-xs bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {oralConditionChips.map(({ label, field }) => (
                    <label key={field}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${draftOral[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                      <input type="checkbox" checked={!!draftOral[field]}
                        onChange={(e) => {
                          const next = { ...draftOral, [field]: e.target.checked };
                          setDraftOral(next);
                          syncChartDateFromConditions(next, othersOralOpen);
                        }}
                        className="w-4 h-4 rounded accent-primary" />
                      {label}
                    </label>
                  ))}
                  {/* othersOralOpen is the ONE source of truth for both the
                      tick and the box below -- unticking it here is the only
                      way the box hides, and it also clears any typed text so
                      an unticked "Others" can't silently leave stale text
                      saved underneath it. */}
                  <button type="button" onClick={() => {
                      const next = !othersOralOpen;
                      setOthersOralOpen(next);
                      if (!next) {
                        const nextOral = { ...draftOral, others: '' };
                        setDraftOral(nextOral);
                        syncChartDateFromConditions(nextOral, false);
                      } else {
                        syncChartDateFromConditions(draftOral, true);
                      }
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-colors ${othersOralOpen ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${othersOralOpen ? 'bg-primary border-primary' : 'border-gray-600'}`}>
                      {othersOralOpen && <Check className="w-3 h-3 text-white" />}
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
                  {/* Visit 1 / Visit 2 (2026-09-25), right-aligned on this same
                      row. Only appears once Visit 1 has actually been
                      recorded -- before that there is nothing to switch
                      between. Visit 1 stays selectable/editable via its own
                      tab; the default (no explicit pick) is Visit 2, since
                      recording Visit 1 makes Visit 2 the next thing to do. */}
                  {visit1 && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button type="button" onClick={() => setExplicitVisit(1)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                          activeVisit === 1
                            ? 'border-primary bg-primary text-white'
                            : 'border-border text-muted-foreground hover:bg-canvas'
                        }`}>
                        Visit 1
                      </button>
                      <button type="button" onClick={() => setExplicitVisit(2)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                          activeVisit === 2
                            ? 'border-primary bg-primary text-white'
                            : 'border-border text-muted-foreground hover:bg-canvas'
                        }`}>
                        {visit2 ? 'Visit 2' : '+ Visit 2'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {serviceChips.map(({ label, field }) => (
                    <label key={field}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${draftServices[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                      {/* Unticking writes null, not false — see the state above. */}
                      <input type="checkbox" checked={draftServices[field] === true}
                        onChange={(e) => {
                          const next = { ...draftServices, [field]: e.target.checked ? true : null };
                          setDraftServices(next);
                          syncVisitDateFromServices(next);
                        }}
                        className="w-4 h-4 rounded accent-primary" />
                      {label}
                    </label>
                  ))}
                </div>
                {/* Unlocked 2026-09-25 -- ticking a service here now creates
                    the active visit's RPC record on save instead of
                    requiring one to already exist. Shown only pre-save so it
                    doesn't linger once the visit is real. */}
                {!activeVisitRecord && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Recording a service or charting a treatment creates this school year's Visit {activeVisit} when you save.
                  </p>
                )}
              </div>
            </div>
            </div>

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
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-card">
            <div className={`${editingChart ? 'bg-primary' : 'bg-slate-400'} px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white`}>Charting Codes</div>
            {/* View-mode warning (user pick "C", 2026-09-25): a soft red strip
                under the bar, OUTSIDE the faded body so it reads at full strength. */}
            {!editingChart && (
              <p className="flex items-center gap-2 border-l-4 border-destructive bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {canEdit ? 'View mode. Click the pencil icon above to record conditions/treatments.' : 'View only. Editing restricted to Dentist.'}
              </p>
            )}
            <div className={`p-4 ${!editingChart ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <div className={`grid grid-cols-1 ${iptrContext === 'default' ? 'lg:grid-cols-2' : ''} gap-4`}>
                {iptrContext !== 'treatment' && (
                <div className={iptrContext === 'default' ? 'lg:pr-4' : undefined}>
                  <div className="flex items-center justify-between gap-2 mb-2 min-h-[26px]">
                    <div className="text-sm font-bold text-primary uppercase tracking-wide">Condition Codes</div>
                    {editingChart && chartedConditionCount > 0 && (
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
                        className={`${paletteBtn} ${selectedCondition === c.code ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                        {c.perm === '✓' ? <span className="text-2xl leading-none">✓</span> : conditionCodeText(c)}
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
                          className={`${paletteBtn} ${selectedCondition === c.code ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                          {c.perm === '✓' ? <span className="text-2xl leading-none">✓</span> : conditionCodeText(c)}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedCondition && (() => {
                    const c = conditionCodes.find((x) => x.code === selectedCondition);
                    return (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="font-palette text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                          {c ? conditionCodeText(c) : ''} · {c?.label} (Click teeth to apply)
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
                    {editingChart && chartedTreatmentCount > 0 && (
                      <button onClick={() => setConfirmClear('treatment')}
                        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-all hover:border-red-400 hover:text-destructive">
                        <Trash2 className="h-3 w-3" /> Clear All ({chartedTreatmentCount})
                      </button>
                    )}
                  </div>
                  {/* Per-tooth treatments ONLY (user, 2026-09-24). The whole-mouth
                      codes (OEX, FV, OP, CONS) and their "More" button are gone:
                      those are recorded under Treatments Given. An old tooth
                      still carrying one shows it on the chart and in the
                      Treatment Summary, and is cleared with the eraser (paint
                      the tooth with no code selected). */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {perToothTreatmentCodes.map((t) => (
                      <button key={t.code} title={treatmentLabel(t)}
                        onClick={() => { setSelectedTreatment(selectedTreatment === t.code ? null : t.code); setSelectedCondition(null); }}
                        className={`${paletteBtn} ${selectedTreatment === t.code ? 'bg-blue-600 text-white ring-2 ring-blue-300 border-blue-600' : 'bg-card border-border text-foreground hover:border-blue-400'}`}>
                        {t.code}
                      </button>
                    ))}
                  </div>
                  {selectedTreatment && (() => {
                    const t = treatmentCodes.find((x) => x.code === selectedTreatment);
                    return (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="font-palette text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {selectedTreatment} · {t?.label} (Click teeth to apply)
                        </span>
                        <button onClick={() => setSelectedTreatment(null)} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
                      </div>
                    );
                  })()}
                </div>
                )}
              </div>
            </div>
            </div>

            {chartError && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-danger-surface px-3 py-2 text-xs font-medium text-destructive">
                <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                <span>{chartError}</span>
              </div>
            )}

            <div className="relative bg-card rounded-xl border border-slate-300 p-4 overflow-x-auto">
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
            <div className="grid grid-cols-1 lg:grid-cols-[9fr_11fr] items-start gap-4">
              {/* Side by side from lg: Dental Condition Summary a little narrower
                  (9fr, about 45%), Treatment Summary wider (11fr), user 2026-09-25. Stacked below
                  lg, both are full width, so the same size. */}
              {/* ── The two summaries, "option A" (user, 2026-09-24): white
                  cards with a coloured header band, soft striped rows, bold
                  counts, tooth numbers as small tags and "Yes" as a green
                  badge. Visit 1 / Visit 2 headings reuse the amber / violet of
                  the V1/V2 tooth badges. No vertical divider and no ruled
                  filler (user): each card is as tall as its own content. ── */}
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="bg-teal-700 px-4 py-2.5 text-sm font-bold text-white">Dental Condition Summary</div>

                {/* 42% label column = Indicate Number's first column below, so
                    the answers start on the same line as its Tooth Count. */}
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[42%]" /><col className="w-[58%]" /></colgroup>
                  <tbody className="[&>tr:nth-child(even)>td]:bg-slate-50/70">
                    <tr>
                      <td className={sumCell}>Date of Oral Examination</td>
                      <td className={`${sumCell} font-bold`}>{draftChartDate ? formatDate(draftChartDate) : ''}</td>
                    </tr>
                    {/* AUTOMATIC (2026-09-25) — see isOrallyFitChild above:
                        no oral condition present and no tooth carrying a
                        treatment code. */}
                    <tr>
                      <td className={sumCell}>Orally Fit Child</td>
                      <td className={sumCell}>{isOrallyFitChild && <span className={yesBadge}>✓ Yes</span>}</td>
                    </tr>
                    {presentOralConditions.map(({ label, present }) => (
                      <tr key={label}>
                        <td className={sumCell}>{label}</td>
                        <td className={sumCell}>{present && <span className={yesBadge}>✓ Yes</span>}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className={sumCell}>Others</td>
                      <td className={`${sumCell} break-words`}>{draftOral.others}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Section B of the paper IPTR, verbatim rows and order. Every
                    figure is DERIVED from the teeth above — none of it is
                    typed, so it cannot disagree with the odontogram. */}
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[42%]" /><col className="w-[23%]" /><col className="w-[35%]" /></colgroup>
                  <thead>
                    <tr className={sumHead}>
                      <th className="px-3 py-2 align-bottom">Indicate Number</th>
                      <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Count" /></th>
                      <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Numbers" /></th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr:nth-child(even)>td]:bg-slate-50/70">
                    {indicateNumberRows.map(({ label, teeth }) => (
                      <tr key={label}>
                        <td className={sumCell}>{label}</td>
                        <td className={`${sumCell}`}>{teeth.length ? teeth.length : ''}</td>
                        <td className={sumCell}><ToothTags teeth={teeth} tone="teal" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="bg-primary px-4 py-2.5 text-sm font-bold text-white">Treatment Summary</div>

                {/* ONE table, laid out like the user's spreadsheet (2026-09-24):
                    Visit 1 | Visit 2 side by side, the date + whole-mouth
                    services on top, then the per-tooth codes with a Tooth
                    Count / Tooth Number pair per visit. The visit being edited
                    reads the live draft; the other visit reads its saved
                    PREVENTIVE_CARE_RECORD. Services show "Yes" only for a real
                    true -- null and false both blank, because the paper form
                    has no tick for "withheld". */}
                <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] table-fixed border-collapse text-xs">
                  <colgroup><col className="w-[30%]" /><col className="w-[15%]" /><col className="w-[20%]" /><col className="w-[15%]" /><col className="w-[20%]" /></colgroup>
                  <thead>
                    <tr>
                      {/* Greys only, darkest to lightest from the empty corner cell
                          (slate-300, 200, 100), headings in capitals (user, 2026-09-25). */}
                      <th className="bg-slate-300 px-3 py-2" />
                      <th colSpan={2} className="bg-slate-200 px-3 py-2 text-center text-[10.5px] font-normal uppercase tracking-wide text-slate-600">Visit 1</th>
                      <th colSpan={2} className="bg-slate-100 px-3 py-2 text-center text-[10.5px] font-normal uppercase tracking-wide text-slate-600">Visit 2</th>
                    </tr>
                  </thead>
                  {(() => {
                    const visitCol = (n: 1 | 2) => {
                      if (n === activeVisit) return { date: draftVisitDate, services: draftServices };
                      const rec = n === 1 ? visit1 : visit2;
                      return {
                        date: rec ? new Date(rec.visit_date).toISOString().slice(0, 10) : '',
                        services: Object.fromEntries(serviceChips.map(({ field }) => [field, rec?.[field] ?? null])) as Record<ServiceField, boolean | null>,
                      };
                    };
                    const cols = [visitCol(1), visitCol(2)];
                    return (
                      <>
                        <tbody className="[&>tr:nth-child(even)>td]:bg-slate-50/70">
                          <tr>
                            <td className={sumCell}>Date of Treatment</td>
                            {cols.map((c, i) => (
                              <td key={i} colSpan={2} className={`${sumCell} text-center font-bold`}>{c.date ? formatDate(c.date) : ''}</td>
                            ))}
                          </tr>
                          {serviceChips.map(({ label, field }) => (
                            <tr key={field}>
                              <td className={sumCell}>{label}</td>
                              {cols.map((c, i) => (
                                <td key={i} colSpan={2} className={`${sumCell} text-center`}>{c.services[field] === true && <span className={yesBadge}>✓ Yes</span>}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                        <tbody className="[&>tr:nth-child(even)>td]:bg-slate-50/70">
                          <tr className={sumHead}>
                            <th className="px-3 py-2 align-bottom">Treatment</th>
                            <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Count" /></th>
                            <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Numbers" /></th>
                            <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Count" /></th>
                            <th className="px-3 py-2 align-bottom xl:whitespace-nowrap"><TwoWord a="Tooth" b="Numbers" /></th>
                          </tr>
                          {perToothTreatmentRows.map((t) => {
                            const v1 = treatmentTeethVisit1[t.code] ?? [];
                            const v2 = treatmentTeethVisit2[t.code] ?? [];
                            return (
                              <tr key={t.code}>
                                <td className={sumCell}><span className="mr-1 font-bold">{t.code}</span>{t.label}</td>
                                <td className={`${sumCell}`}>{v1.length ? v1.length : ''}</td>
                                <td className={sumCell}><ToothTags teeth={v1} tone="blue" /></td>
                                <td className={`${sumCell}`}>{v2.length ? v2.length : ''}</td>
                                <td className={sumCell}><ToothTags teeth={v2} tone="blue" /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </>
                    );
                  })()}
                </table>
                </div>
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
                <div><span className="font-mono font-bold text-foreground">DMFT</span>: permanent teeth Decayed + Missing + Filled</div>
                <div><span className="font-mono font-bold text-foreground">dmft</span>: primary teeth decayed + missing + filled</div>
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
      {/* ── Edit Basic Information (user, 2026-09-25) ─────────────────────
          The same window, field order and styling as Add New Student
          (PatientList), titled for editing. Grade/Section appear twice on
          purpose: the SELECTED YEAR's (what that year's forms print) and the
          student's CURRENT enrolment (what rosters read). The selected year's
          own Grade/Section pair was removed from this window (user,
          2026-09-25); it is saved back unchanged. */}
      {editingInfo && draftInfo && (
        <Modal onClose={() => setEditingInfo(false)} maxWidth="max-w-4xl" closeDisabled={infoSaving}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card p-6">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Basic Information
              </div>
              <h2 className="text-lg font-bold text-foreground">Edit Student Basic Information</h2>
            </div>
            <button type="button" onClick={() => setEditingInfo(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          {/* "Not a Student", as on Add New Student: a person treated here who
              is not enrolled. Grade and Section do not apply, so ticking it
              clears and locks both pairs (this year's and current). */}
          <div className="mx-6 mt-4 flex items-center gap-2">
            <input type="checkbox" id="edit-not-student" checked={!!draftInfo.is_not_student}
              onChange={(e) => {
                const checked = e.target.checked;
                setDraftInfo((p) => ({ ...p, is_not_student: checked, ...(checked ? { grade_level: '', section: '' } : {}) }));
                if (checked) setDraftYear((p) => ({ ...p, grade_level: '', section: '' }));
              }}
              className="h-4 w-4 rounded accent-primary" />
            <label htmlFor="edit-not-student" className="text-sm font-medium text-foreground">Not a Student</label>
          </div>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label className="block text-sm font-medium text-foreground mb-1">Last Name{infoReq('last_name')}</label><input type="text" value={draftInfo.last_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, last_name: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />{infoMiss('last_name')}</div>
              <div><label className="block text-sm font-medium text-foreground mb-1">First Name{infoReq('first_name')}</label><input type="text" value={draftInfo.first_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, first_name: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />{infoMiss('first_name')}</div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div><label className="block text-sm font-medium text-foreground mb-1">Middle Name</label><input type="text" value={draftInfo.middle_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, middle_name: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div><label className="block text-sm font-medium text-foreground mb-1">Birthdate{infoReq('birthday')}</label><input type="date" value={draftInfo.birthday ? String(draftInfo.birthday).slice(0, 10) : ''} onChange={(e) => setDraftInfo((p) => ({ ...p, birthday: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />{infoMiss('birthday')}</div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Age</label>
                <input type="text" readOnly disabled value={draftInfo.birthday ? computeAge(String(draftInfo.birthday).slice(0, 10), new Date()) : ''} placeholder="Automatically calculated" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-not-allowed bg-muted text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Sex{infoReq('sex')}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['Male', 'Female'] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setDraftInfo((p) => ({ ...p, sex: g }))}
                    className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${draftInfo.sex === g ? 'border-primary-hover bg-primary text-white' : 'border-border text-foreground hover:bg-canvas'}`}>{g}</button>
                ))}
              </div>
              {infoMiss('sex')}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Grade{infoReq('grade_level')}</label>
                <select value={draftInfo.grade_level ?? ''} disabled={!!draftInfo.is_not_student} onChange={(e) => setDraftInfo((p) => ({ ...p, grade_level: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-card disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">
                  <option value="">Select Grade</option>{GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
                {infoMiss('grade_level')}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Section{infoReq('section')}</label>
                <input type="text" value={draftInfo.section ?? ''} disabled={!!draftInfo.is_not_student} onChange={(e) => setDraftInfo((p) => ({ ...p, section: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" />
                {infoMiss('section')}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label className="block text-sm font-medium text-foreground mb-1">Place of Birth<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.place_of_birth ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, place_of_birth: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div><label className="block text-sm font-medium text-foreground mb-1">Contact Number<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.contact_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, contact_number: e.target.value }))} placeholder="09XX-XXX-XXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label className="block text-sm font-medium text-foreground mb-1">Guardian Name<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.guardian_name ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_name: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div><label className="block text-sm font-medium text-foreground mb-1">Guardian Contact<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.guardian_contact ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_contact: e.target.value }))} placeholder="09XX-XXX-XXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            </div>
            <div><label className="block text-sm font-medium text-foreground mb-1">Occupation<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.guardian_occupation ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, guardian_occupation: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label className="block text-sm font-medium text-foreground mb-1">PhilHealth Number<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.philhealth_number ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_number: e.target.value, ...(e.target.value.trim() === '' ? { philhealth_status: 'None' as const } : {}) }))} placeholder="XX-XXXXXXXXX-X" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">PhilHealth Status</label>
                {/* Only meaningful with a number (user, 2026-09-24). */}
                <select value={(draftInfo.philhealth_number ?? '').trim() ? (draftInfo.philhealth_status ?? 'None') : 'None'}
                  disabled={!(draftInfo.philhealth_number ?? '').trim()}
                  title={(draftInfo.philhealth_number ?? '').trim() ? undefined : 'Enter a PhilHealth number first'}
                  onChange={(e) => setDraftInfo((p) => ({ ...p, philhealth_status: e.target.value as 'None' | 'Principal' | 'Dependent' }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-card disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">
                  <option value="None">None</option><option value="Principal">Principal</option><option value="Dependent">Dependent</option>
                </select>
              </div>
            </div>
            <div><label className="block text-sm font-medium text-foreground mb-1">Address<span className="font-normal text-muted-foreground"> (Optional)</span></label><input type="text" value={draftInfo.address ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, address: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="edit-is4ps" checked={!!draftInfo.is_4ps} onChange={(e) => setDraftInfo((p) => ({ ...p, is_4ps: e.target.checked }))} className="h-4 w-4 rounded accent-primary" />
              <label htmlFor="edit-is4ps" className="text-sm font-medium text-foreground">4Ps / NHTS Member</label>
            </div>
            {draftInfo.is_4ps && (
              <div><label className="block text-sm font-medium text-foreground mb-1">4Ps ID{infoReq('fourps_id')}</label><input type="text" value={draftInfo.fourps_id ?? ''} onChange={(e) => setDraftInfo((p) => ({ ...p, fourps_id: e.target.value }))} placeholder="4PS-XXXXXXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />{infoMiss('fourps_id')}</div>
            )}
          </div>
          <div className="sticky bottom-0 z-10 border-t bg-card p-6">
            {/* Next to the buttons, not at the top of a long form: a save that
                is refused must say why where the user is looking. */}
            {infoError && <p role="alert" className="mb-3 rounded-lg border border-destructive/20 bg-danger-surface px-3 py-2 text-sm text-destructive">{infoError}</p>}
            <div className="flex gap-3">
            <button type="button" onClick={() => setEditingInfo(false)} disabled={infoSaving} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-gray-50 disabled:opacity-60">Cancel</button>
            <button type="button" onClick={handleSaveInfoClick} disabled={infoSaving || !infoDirty}
              title={infoDirty ? undefined : 'No changes to save'} className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60">{infoSaving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </div>
        </Modal>
      )}
      {/* One step between Save Changes and the write (user, 2026-09-25). */}
      <ConfirmDialog
        open={confirmSaveInfo}
        tone="default"
        title="Save changes to this student's basic information?"
        message={draftInfo ? `${draftInfo.last_name ?? ''}, ${draftInfo.first_name ?? ''}` : ''}
        confirmLabel="Save Changes"
        busy={infoSaving}
        onConfirm={async () => { setConfirmSaveInfo(false); await handleSaveInfo(); }}
        onCancel={() => setConfirmSaveInfo(false)}
      />
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
