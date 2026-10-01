import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, ChevronLeft, ChevronRight, Shield, Users, FileText, Plus, Pencil, Trash2, Download, X, Maximize2, Check, ChevronUp, ChevronDown, ShieldCheck, ShieldAlert, Shield as ShieldIcon, MoreVertical } from 'lucide-react';
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
import { ageOn } from '../utils/age';
import { schoolYearLabel } from '../utils/schoolYear';
import { TOPBAR_H } from '../utils/layout';
import { surnameFirst, surnameFirstWithInitial } from '../utils/studentName';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { removeQueuedStudentId, getQueuedStudentIds, getEffectiveQueueOrder } from '../utils/queueStorage';
import { addTreatmentQueueStudentId, getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';
import { invalidateCached } from '../utils/apiCache';
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
import { DentalChartTab } from './DentalChartTab';
import { emptyMed, medDraftFrom, emptyDiet, emptyOral, oralConditionChips, serviceChips, type MedicalHistoryDraft, type DietDraft, type OralDraft, type ServiceField } from './iptrDrafts';
import type { ReferralType, ApiAppointment } from '../api/types';
import {
  sectionBRows,
  teethByTreatment as teethByTreatmentCode,
  hasCaries,
  type ChartedTooth,
} from '../../../shared/iptrSectionB';
// The chart's vocabulary and arithmetic — moved out in Sprint 162, unchanged.
// Re-exported below for the four screens that import these from here.
import {
  temporaryTeeth,
  conditionColors,
  computeDMFT,
  WHOLE_MOUTH_TREATMENT_CODES,
  conditionCodes,
  treatmentCodes,
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
// Matches PatientList.tsx's own GENDER_SORT_ORDER exactly (user, 2026-09-27)
// -- the default-context nav below has to sort like that module's table.
const GENDER_SORT_ORDER: Record<string, number> = { Male: 0, Female: 1 };

// The draft shapes and their empty factories moved to `iptrDrafts.ts` in
// Sprint 162c — shared by this host, the History tab and the Dental Chart tab.

const formatDateStamp = (dateString?: string | null) => formatDate(dateString, 'No date stamp');

// A school year's date stamp IS its Oral Conditions "Date examined" (user,
// 2026-09-25): DENTAL_CHART.date_charted, shown only while an oral condition
// is recorded, so the chip and the field can never disagree. Replaces the
// separate "Edit date" menu item.
// ⚠ "An oral condition is recorded" also means a TOOTH condition (user,
// 2026-09-28: "there is condition marked in the dental chart but there is no
// date in the Oral Conditions Date examined") -- the whole-mouth chips
// (Debris, Gingivitis, ...) are not the only thing this form calls an oral
// condition, and a mouth charted tooth-by-tooth with no whole-mouth finding
// ticked is still an examined mouth.
const examinedDate = (
  oc: { debris?: boolean; gingivitis?: boolean; calculus?: boolean; periodontal_disease?: boolean; cleft_lip_palate?: boolean; abnormal_growth?: boolean; others?: string } | null | undefined,
  chart: { date_charted?: string } | null | undefined,
  toothRecords?: { condition?: string }[] | null,
): string | null => {
  const examined = (!!oc && (oc.debris || oc.gingivitis || oc.calculus || oc.periodontal_disease || oc.cleft_lip_palate || oc.abnormal_growth || !!oc.others?.trim()))
    || !!toothRecords?.some((tr) => !!tr.condition);
  return examined && chart?.date_charted ? chart.date_charted : null;
};



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

  // ⚠ 'appointments' (the Consent tab) is gone as of Sprint 171 — six tabs,
  // hers. Consent lives on the History banner, which is where she put it.
  type TabKey = 'history' | 'chart' | 'records' | 'treatments' | 'referrals' | 'ai';
  type IptrContext = 'default' | 'dental-queue' | 'risk' | 'treatment';
  const iptrContext = (searchParams.get('context') as IptrContext) || 'default';
  // Layout/tabs treat dental-queue AND treatment exactly like default (user,
  // 2026-09-27 for dental-queue; user, 2026-09-28 for treatment, after
  // several rounds of individually patching context-specific hides kept
  // missing spots: "rewrite the code that when open chart is click in the
  // treatment queue submodule, then it will access the IPTR page with all
  // the functions" -- rather than keep threading `layoutContext ===
  // 'treatment'` exceptions through every panel one at a time, treatment now
  // collapses into 'default' at this single point, same as dental-queue
  // already does, so nothing downstream needs its own case for it.
  // `iptrContext` itself (NOT layoutContext) stays distinct for the things
  // that SHOULD still differ per module: the prev/next nav order below, the
  // save-then-navigate-to-AI-Analytics behavior further down, the sidebar
  // highlight (Root.tsx reads the raw ?context= query param, not this
  // value), and the Back button's destination.
  const layoutContext = (iptrContext === 'dental-queue' || iptrContext === 'treatment') ? 'default' : iptrContext;

  // Appointments-today, fetched ONLY for the dental-queue nav below (user,
  // 2026-09-27): "Next" has to agree with the Queue # shown on the Dental
  // Charts page itself, which bypasses raw queue position for students with
  // an appointment today -- not just the order they were added to the
  // queue. getEffectiveQueueOrder (shared with DentalChartNav) needs this
  // same set to compute that identical order.
  const [queueAppointmentsTodayIds, setQueueAppointmentsTodayIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (iptrContext !== 'dental-queue') return;
    let cancelled = false;
    (async () => {
      try {
        const appts = await apiClient.get<ApiAppointment[]>('/appointments');
        const today = toLocalDateString(new Date());
        const ids = new Set(
          appts.filter((a) => !a.isArchived && toLocalDateString(new Date(a.appointment_datetime)) === today).map((a) => a.student_id),
        );
        if (!cancelled) setQueueAppointmentsTodayIds(ids);
      } catch {
        // Best-effort -- nav just falls back to raw queue order below.
      }
    })();
    return () => { cancelled = true; };
  }, [iptrContext]);

  // Real patient nav (school-scoped like every list page, sorted by name for
  // a stable, predictable order) -- EXCEPT from the Charting Queue (user,
  // 2026-09-27): "the next student should be the next student in the
  // charting queue", BY QUEUE NUMBER (the same appointments-today-bypass
  // order the queue table itself shows), not the raw order students were
  // added to the queue. Opened from Treatment (user, 2026-09-28: "the next
  // student should also be based depending on whose the student in the
  // next treatment queue") gets the same treatment, against the Treatment
  // Queue's own order instead -- that queue has no appointments-today
  // bypass, so it's just the stored order as-is.
  const queueNavList = useMemo(() => {
    if (iptrContext === 'dental-queue') {
      const byId = new Map(allStudents.map((s) => [s.id, s]));
      const ordered = getEffectiveQueueOrder(getQueuedStudentIds(), queueAppointmentsTodayIds);
      return ordered.map((qid) => byId.get(qid)).filter((s): s is (typeof allStudents)[number] => !!s);
    }
    if (iptrContext === 'treatment') {
      const byId = new Map(allStudents.map((s) => [s.id, s]));
      return getTreatmentQueueStudentIds().map((qid) => byId.get(qid)).filter((s): s is (typeof allStudents)[number] => !!s);
    }
    return null;
  }, [iptrContext, allStudents, queueAppointmentsTodayIds]);
  const navList = useMemo(() => {
    if (queueNavList) return queueNavList;
    const scoped = selectedSchool ? allStudents.filter((s) => s.school === selectedSchool) : [...allStudents];
    // Opened from Student Records (iptrContext === 'default', no ?context=)
    // sorts the SAME way that module's own table does -- grade, section,
    // gender, surname, first name -- not plain alphabetical (user,
    // 2026-09-27: "the next student should be the next student in the
    // student list, not alphabetical"). risk context keeps the simple
    // alphabetical fallback, unaffected (dental-queue and treatment never
    // reach here -- queueNavList above already returned for both).
    if (iptrContext === 'default') {
      return [...scoped].sort((a, b) =>
        (GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade)) ||
        a.section.localeCompare(b.section) ||
        ((GENDER_SORT_ORDER[a.gender] ?? 2) - (GENDER_SORT_ORDER[b.gender] ?? 2)) ||
        (a.lastName || a.name).localeCompare(b.lastName || b.name) ||
        (a.firstName ?? '').localeCompare(b.firstName ?? '')
      );
    }
    return [...scoped].sort((a, b) => a.name.localeCompare(b.name));
  }, [queueNavList, allStudents, selectedSchool, iptrContext]);
  const navIndex = navList.findIndex((s) => s.id === id);
  const prevPatient = navIndex > 0 ? navList[navIndex - 1] : null;
  const nextPatient = navIndex >= 0 && navIndex < navList.length - 1 ? navList[navIndex + 1] : null;
  const [chartingMode, setChartingModeState] = useState(chartingModeMemo);
  const setChartingMode = (on: boolean) => { chartingModeMemo = on; setChartingModeState(on); };
  // An explicit ?tab= still wins — a deep link says where to land. Otherwise a
  // remount inside charting mode has to come back to the CHART tab, or the
  // dentist arrives at the next child on History with the mode still on.
  // Opened from Treatment (user, 2026-09-28: "the dental chart should be
  // the default view") always lands on Chart too, same as charting mode,
  // independent of whether charting mode itself is on.
  const initialTab = (searchParams.get('tab') as TabKey) || (chartingModeMemo || iptrContext === 'treatment' ? 'chart' : 'history');
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
  // Keyed on layoutContext, not iptrContext (user, 2026-09-27) -- dental-
  // queue used to restrict this to just History + Chart; it now shows every
  // tab, same as opening a chart from the Students module. Treatment used to
  // restrict this to just Chart + Treatment too; user, 2026-09-28: "all tabs
  // in the IPTR should still be accessible" from there as well -- only the
  // DEFAULT tab (see initialTab below) is treatment-specific now, not which
  // tabs are reachable.
  const visibleTabs = (
    layoutContext === 'risk'
      ? allTabs.filter((tab) => tab.key === 'ai')
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
  // Whether a visit's RECORD is backed by real content (any service ticked,
  // or any tooth tagged to it), not just whether the row exists (user,
  // 2026-09-28: "when oral conditions and treatment and dental chart is
  // empty ... visit 2 should be hidden again too"). Visit 1's record is
  // exempt from archiving (it always stays), so it can go back to "empty"
  // after a clear-everything save while still technically existing --
  // Visit 2 should only be offered once Visit 1 has real data again, not
  // merely because its row is still sitting there. "Visit 1" here is the
  // same catch-all Treatment Summary's own V1/V2 split uses: visit_number 1
  // AND untagged/legacy teeth.
  const hasRealVisitData = (visitNumber: 1 | 2, record?: typeof visit1) => {
    if (!record) return false;
    if ([record.oral_screening, record.oral_prophylaxis, record.fluoride_varnish, record.oral_hygiene_instruction, record.consultation].some((v) => v === true)) return true;
    const teeth = currentYearData?.toothRecords ?? [];
    return visitNumber === 2 ? teeth.some((tr) => tr.visit_number === 2) : teeth.some((tr) => (tr.visit_number ?? 1) !== 2);
  };
  const visit1HasData = hasRealVisitData(1, visit1);
  const visit2HasData = hasRealVisitData(2, visit2);
  const [explicitVisit, setExplicitVisit] = useState<1 | 2 | null>(null);
  // No explicit pick yet — default to Visit 2 once Visit 1 is recorded and
  // Visit 2 isn't: the next thing to do, not a re-read of what's already
  // recorded.
  const activeVisit: 1 | 2 = explicitVisit ?? (visit1HasData && !visit2 ? 2 : 1);
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
  // Kept ONE PER VISIT, not one shared slot for "whichever tab is active"
  // (fixed 2026-09-28: "when i uncheck anything in visit 2 ... go to visit 1
  // and made edits ... when i save, the unchecked boxes in visit 2 gets
  // checked again"). A single shared draft meant switching tabs overwrote
  // whatever was in progress for the visit being left with that visit's
  // last-SAVED data, and Save only ever wrote the currently-active visit —
  // so an in-progress Visit 2 uncheck was silently discarded the moment the
  // dentist switched to Visit 1, never reaching the server at all.
  const emptyServiceDraft: Record<ServiceField, boolean | null> = {
    oral_screening: null, oral_prophylaxis: null, fluoride_varnish: null, oral_hygiene_instruction: null, consultation: null,
  };
  const [draftServicesByVisit, setDraftServicesByVisit] = useState<Record<1 | 2, Record<ServiceField, boolean | null>>>({
    1: emptyServiceDraft, 2: emptyServiceDraft,
  });
  const [draftVisitDateByVisit, setDraftVisitDateByVisit] = useState<Record<1 | 2, string>>({ 1: '', 2: '' });
  // Everything below this line still reads/writes "draftServices" /
  // "draftVisitDate" as if it were the old single slot — these are thin
  // views onto the active visit's slot in the map above, so none of that
  // code had to change.
  const draftServices = draftServicesByVisit[activeVisit];
  const draftVisitDate = draftVisitDateByVisit[activeVisit];
  const setDraftServices = (next: Record<ServiceField, boolean | null>) =>
    setDraftServicesByVisit((prev) => ({ ...prev, [activeVisit]: next }));
  const setDraftVisitDate = (next: string | ((prev: string) => string)) =>
    setDraftVisitDateByVisit((prev) => ({
      ...prev,
      [activeVisit]: typeof next === 'function' ? (next as (prev: string) => string)(prev[activeVisit]) : next,
    }));
  // LIVE version of "has real content", reflecting the in-progress DRAFT
  // rather than the last-SAVED record (user, 2026-09-28: "it should be real
  // time ... the moment that visit 1 is empty, it should hide the visit 2
  // button automatically"). visit1HasData/visit2HasData above are
  // deliberately saved-data-only (they seed the initial date display on
  // load, see the population effect below); this is what the Visit 2 button
  // and the tab-reset safeguard watch, so unchecking Visit 1's last service
  // or clearing its last tooth hides Visit 2 immediately while editing,
  // without waiting for Save.
  const draftVisitHasData = (n: 1 | 2) =>
    Object.values(draftServicesByVisit[n]).some((v) => v === true)
    || Object.values(draftChart).some((e) => e.condition && (n === 2 ? e.visitNumber === 2 : (e.visitNumber ?? 1) !== 2));
  const visit1HasDataLive = draftVisitHasData(1);
  // Visit 2's button hides the moment Visit 1 goes empty (live, above), but
  // an explicit pick of Visit 2 from BEFORE that happened would otherwise
  // stick -- `??` only falls back to the default when explicitVisit is null,
  // so unchecking Visit 1 down to empty while Visit 2 is the open tab would
  // leave the panel showing Visit 2's (now-hidden-button) content with no
  // visible way back. Snap back to the default the instant that combination
  // occurs.
  useEffect(() => {
    if (!visit1HasDataLive && explicitVisit === 2) setExplicitVisit(null);
  }, [visit1HasDataLive, explicitVisit]);

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

    const examined = examinedDate(currentYearData.oralCondition, currentYearData.dentalChart, currentYearData.toothRecords);
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

  // Treatments Given's services/date follow BOTH visits' own SOURCE records,
  // not the whole draft-population effect above -- a SEPARATE effect on
  // purpose, so loading a new student/year only refreshes the services
  // cards, not in-progress unsaved teeth/history edits (which would be lost
  // if this were folded into the effect above, since that one fully
  // re-syncs everything from source data on every dependency change).
  // ⚠ Deliberately NOT keyed on `activeVisit`/`activeVisitRecord` -- that was
  // the bug (see the draft-state comment above): re-deriving on every tab
  // switch overwrote whichever visit's checkboxes were being left. This
  // fires once per real data load (or after Save's `reload()`) and fills
  // BOTH visits' slots, so switching tabs afterward just changes which slot
  // is on screen -- it never touches either slot's contents.
  useEffect(() => {
    const forVisit = (visit: typeof visit1, hasData: boolean) => ({
      date: visit && hasData ? new Date(visit.visit_date).toISOString().slice(0, 10) : '',
      services: {
        oral_screening: visit?.oral_screening ?? null,
        oral_prophylaxis: visit?.oral_prophylaxis ?? null,
        fluoride_varnish: visit?.fluoride_varnish ?? null,
        oral_hygiene_instruction: visit?.oral_hygiene_instruction ?? null,
        consultation: visit?.consultation ?? null,
      },
    });
    const v1 = forVisit(visit1, visit1HasData);
    const v2 = forVisit(visit2, visit2HasData);
    setDraftServicesByVisit({ 1: v1.services, 2: v2.services });
    setDraftVisitDateByVisit({ 1: v1.date, 2: v2.date });
  }, [currentYearData, visit1, visit2, visit1HasData, visit2HasData]);

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
  // Preserves ?context= across Prev/Next (user, 2026-09-27): without this,
  // the FIRST click off a dental-queue (or risk/treatment) link worked, but
  // landing on a bare `/dental-chart/:id` dropped the context, so the very
  // next Prev/Next silently fell back to the default alphabetical nav list.
  const navQuery = iptrContext !== 'default' ? `?context=${iptrContext}` : '';
  // Only warn when there's actually something to lose (user, 2026-09-27) --
  // being in edit mode with nothing typed or ticked yet is not "unsaved
  // work", so Prev/Next/Back should just navigate silently in that case.
  // Checks every field the Medical History and Dental Chart tabs write:
  // per-tooth conditions/treatments, whole-mouth services, medical history
  // flags/text, dietary/social habits, and oral conditions.
  const hasUnsavedChartContent =
    Object.values(draftChart).some((e) => e.condition || e.treatment) ||
    Object.values(draftServicesByVisit[1]).some((v) => v === true) ||
    Object.values(draftServicesByVisit[2]).some((v) => v === true) ||
    Object.values(draftMed).some((v) => v === true || (typeof v === 'string' && v.trim() !== '')) ||
    Object.values(draftDiet).some((v) => v === true) ||
    Object.values(draftOral).some((v) => v === true || (typeof v === 'string' && v.trim() !== ''));
  const goToStudent = (target: { id: string; name: string } | null) => {
    if (!target) return;
    if (editMode && hasUnsavedChartContent) { setPendingNav(target); return; }
    navigate(`/dental-chart/${target.id}${navQuery}`);
  };

  const currentChart = draftChart;

  // Earliest a visit's "Date treated" is allowed to be (user, 2026-09-28:
  // "it should be impossible to mark a date for treatment past the oral
  // condition ... same with visit 2, it cannot be past treatment visit 1").
  // Visit 1 can't be earlier than the oral exam that found what it treats;
  // Visit 2 can't be earlier than either that exam OR Visit 1. Feeds the
  // date input's `min` (greys out the disallowed range in the calendar
  // picker) -- handleSave re-checks the same ordering server-side-adjacent,
  // since `min` alone doesn't stop a typed value.
  const visitDateMin = activeVisit === 1
    ? draftChartDate
    : [draftChartDate, draftVisitDateByVisit[1]].filter(Boolean).sort().pop() || '';

  // Same ordering rule as `visitDateMin`, as an always-current message
  // instead of a min/max comparison -- shared by the live banner below AND
  // handleSave's own guard, so the two can never disagree (user, 2026-09-28:
  // "this warning should be real time to changes too. it should show and
  // hide when necessary"). `min` alone only stops the calendar picker; this
  // is what catches a typed value and what the live banner explains.
  const computeDateOrderError = (): string | null => {
    const v1Date = draftVisitDateByVisit[1];
    const v2Date = draftVisitDateByVisit[2];
    if (v1Date && draftChartDate && v1Date < draftChartDate) {
      return `Visit 1's Date treated (${formatDate(v1Date)}) can't be before the oral exam's Date examined (${formatDate(draftChartDate)}).`;
    }
    if (v2Date && v1Date && v2Date < v1Date) {
      return `Visit 2's Date treated (${formatDate(v2Date)}) can't be before Visit 1's Date treated (${formatDate(v1Date)}).`;
    }
    if (v2Date && !v1Date && draftChartDate && v2Date < draftChartDate) {
      return `Visit 2's Date treated (${formatDate(v2Date)}) can't be before the oral exam's Date examined (${formatDate(draftChartDate)}).`;
    }
    return null;
  };
  const dateOrderError = editingChart ? computeDateOrderError() : null;
  // Gates the Treatments Given checkboxes on EITHER Oral Conditions OR a
  // charted Tooth Condition Code having something marked -- the "no
  // treatment without a condition" rule, widened 2026-09-28 after the
  // whole-mouth-chips-only version hid Treatments Given even with a real
  // tooth condition charted and nothing else: "either Oral Conditions or
  // the Tooth Condition Codes is filled then the Treatments Given will
  // show, but for Tooth Treatment Codes to show, Tooth Condition Codes
  // should be marked" -- Tooth Treatment Codes stays gated on
  // chartedConditionCount alone (its sibling check below), unchanged.
  const hasOralConditionMarked = oralConditionChips.some(({ field }) => draftOral[field]) || othersOralOpen
    || Object.values(currentChart).some((e) => e.condition);

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
  // BUG-02: the shared `ageOn`. The local copy returned 0 for a missing or
  // unreadable birthday, which printed "Age 0", a fabricated value; callers now
  // get null and print a dash.
  const computeAge = (birthday: string, on: Date) => ageOn(birthday, on);

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
  // ⚠ Only clears the date when no CHARTED TOOTH is left either (2026-09-28
  // fix) -- a mouth charted tooth-by-tooth with no whole-mouth chip ticked
  // is still examined, so untoggling the last chip must not blank a date
  // that a tooth condition still justifies.
  const syncChartDateFromConditions = (oral: OralDraft, othersOpen: boolean) => {
    const anyTicked = oralConditionChips.some(({ field }) => oral[field]) || othersOpen
      || Object.values(currentChart).some((e) => e.condition);
    setDraftChartDate(anyTicked ? (draftChartDate || toLocalDateString(new Date())) : '');
  };
  // Same rule for "Date treated" against the Treatments Given chips -- ALSO
  // checks a tooth charted for the active visit (2026-09-28 fix, same
  // reasoning as Date examined above): a visit recorded purely as tooth
  // work, no whole-mouth service ticked, is still a real visit.
  const syncVisitDateFromServices = (services: Record<ServiceField, boolean | null>) => {
    const anyTicked = serviceChips.some(({ field }) => services[field] === true)
      || Object.values(currentChart).some((e) => e.condition && (activeVisit === 2 ? e.visitNumber === 2 : (e.visitNumber ?? 1) !== 2));
    setDraftVisitDate(anyTicked ? (draftVisitDate || toLocalDateString(new Date())) : '');
  };
  // Re-derives BOTH dates from a chart snapshot that already includes the
  // tooth mutation just made (user, 2026-09-28, repeated report: "the date
  // should be emptied too when there is no marked oral conditions and Tooth
  // Condition Codes ... it must be real time when changes are made").
  // Painting/erasing a tooth previously only touched draftChart -- nothing
  // re-checked the dates afterward, so a tooth that was the LAST thing
  // keeping a date alive left it stuck once cleared. Takes the merged
  // snapshot as an argument rather than reading `draftChart` back, which
  // would still be this render's PRE-mutation value (the same stale-read
  // trap the comment above already calls out for the checkbox handlers).
  const syncDatesFromChart = (mergedChart: Record<number, ChartEntry>) => {
    const anyOralReal = oralConditionChips.some(({ field }) => draftOral[field]) || othersOralOpen
      || Object.values(mergedChart).some((e) => e.condition);
    if (!anyOralReal) setDraftChartDate('');
    ([1, 2] as const).forEach((n) => {
      const anyServiceTicked = Object.values(draftServicesByVisit[n]).some((v) => v === true);
      const anyToothReal = Object.values(mergedChart).some((e) => e.condition && (n === 2 ? e.visitNumber === 2 : (e.visitNumber ?? 1) !== 2));
      if (!anyServiceTicked && !anyToothReal) {
        setDraftVisitDateByVisit((prev) => (prev[n] ? { ...prev, [n]: '' } : prev));
      }
    });
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
    let nextEntry: ChartEntry;
    if (action === 'condition') {
      const codeObj = conditionCodes.find((c) => c.code === value);
      const code = value ? (codeObj ? (isTemp ? codeObj.temp : codeObj.perm) : value) : '';
      nextEntry = { condition: code, treatment: currentChart[toothNumber]?.treatment || '', visitNumber: activeVisit };
    } else if (action === 'treatment') {
      nextEntry = { condition: currentChart[toothNumber]?.condition || '', treatment: value, visitNumber: activeVisit };
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
      nextEntry = { condition: '', treatment: '', visitNumber: null };
    }
    setDraftChart((prev) => ({ ...prev, [toothNumber]: nextEntry }));
    // Toggling a code OFF or erasing empties the date the instant nothing
    // real is left -- toggling one ON is already handled by
    // stampConditionDate/stampTreatmentDate below, which unconditionally
    // stamp today whenever a real value is applied. Merges against
    // `currentChart` (this render's pre-mutation snapshot) plus THIS
    // tooth's new entry, not a re-read of draftChart, which wouldn't
    // reflect this change yet.
    syncDatesFromChart({ ...currentChart, [toothNumber]: nextEntry });
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
        // A visit cannot have happened before the oral exam that found what
        // it's treating, and Visit 2 cannot happen before Visit 1 (user,
        // 2026-09-28: "it should be impossible to mark a date for treatment
        // past the oral condition ... same with visit 2, it cannot be past
        // treatment visit 1"). The date inputs' own `min` already greys this
        // out in the calendar picker, but a typed value bypasses that.
        // `computeDateOrderError` is the SAME function the live banner below
        // reads on every render, so Save can never block on a message the
        // banner didn't already show (or vice versa) -- no setChartError
        // here, since that banner is already on screen; the toast is just
        // Save's own "that's why nothing happened" confirmation.
        const dateOrderMessage = computeDateOrderError();
        if (dateOrderMessage) {
          toast.error(dateOrderMessage);
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
      // year would have nowhere to write the visit. Checked across BOTH
      // visits' drafts (2026-09-28 fix) -- Save now persists whichever visit
      // was actually edited, not just whichever tab happens to be open.
      const hasAnyServiceForVisit = (n: 1 | 2) => Object.values(draftServicesByVisit[n]).some((v) => v === true);
      const hasAnyService = hasAnyServiceForVisit(1) || hasAnyServiceForVisit(2);
      // A treatment charted on a tooth also opens its visit (user,
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
      // instead of the two visits' teeth work being indistinguishable. Reads
      // each tooth's OWN tag (set when it was painted -- see applyToothPaint
      // below), not the tab active at save time (2026-09-28 fix): a tooth
      // painted under Visit 2 then left behind by switching to Visit 1 must
      // still save as Visit 2's, not get silently relabeled Visit 1's.
      const toothWrites = pendingTeeth.map(([toothStr, entry]) => {
        const toothNumber = Number(toothStr);
        const existing = existingByTooth.get(toothNumber);
        const body = { chart_id: chartId, tooth_number: toothNumber, condition: entry.condition, treatment_code: entry.treatment, visit_number: entry.visitNumber ?? activeVisit };
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
      // A visit emptied completely (every service unticked, no tooth work
      // left tagged to it) is RETIRED like a cleared tooth above -- archived,
      // not left behind as a phantom "visit exists but has nothing in it"
      // record. Visit 1 is exempt (it stays visible even empty -- see the
      // tab above), so only Visit 2 can disappear this way (user,
      // 2026-09-28: "i remove all the treatment and conditions in the visit
      // 2 ... there is not visit 2 anymore"). Everything downstream
      // (pipeline status, RPC due dates) reads LIVE preventive-care-records,
      // so this one archive is what makes "no Visit 2" propagate everywhere
      // else automatically, without a second update pass.
      //
      // Built for BOTH visits, not just the active tab (2026-09-28 fix): the
      // per-visit draft slots above mean either visit's checkboxes may have
      // been edited this session, so Save must persist whichever one(s)
      // actually changed, not only whichever tab happened to be open when
      // the button was clicked.
      const remainingVisitTeeth = (n: 1 | 2) => pendingTeeth.some(([, entry]) => (entry.visitNumber ?? activeVisit) === n)
        || Array.from(existingByTooth.values()).some((tr) => tr.visit_number === n && !clearedRecords.includes(tr));
      const chartsTreatmentForVisit = (n: 1 | 2) => pendingTeeth.some(([, entry]) => entry.treatment !== '' && (entry.visitNumber ?? activeVisit) === n);
      const buildVisitWrite = (n: 1 | 2) => {
        const services = draftServicesByVisit[n];
        const visitDate = draftVisitDateByVisit[n];
        const record = n === 1 ? visit1 : visit2;
        const hasAnyServiceN = hasAnyServiceForVisit(n);
        const nowEmptyN = !hasAnyServiceN && !remainingVisitTeeth(n);
        if (record) {
          if (n === 2 && nowEmptyN) return apiClient.patch(`/preventive-care-records/${record._id}/archive`);
          return apiClient.put(`/preventive-care-records/${record._id}`, {
            ...services,
            ...(visitDate ? { visit_date: visitDate } : {}),
          });
        }
        if (hasAnyServiceN || chartsTreatmentForVisit(n)) {
          return apiClient.post('/preventive-care-records', {
            iptr_id: currentYearData.iptr._id,
            visit_date: visitDate || draftChartDate || toLocalDateString(new Date()),
            visit_number: n,
            ...services,
          });
        }
        return null;
      };
      const visit1Write = buildVisitWrite(1);
      const visit2Write = buildVisitWrite(2);
      if (visit1Write) extraWrites.push(visit1Write);
      if (visit2Write) extraWrites.push(visit2Write);
      const savedChartId = currentYearData.dentalChart?._id;
      if (savedChartId && draftChartDate
          && draftChartDate !== new Date(currentYearData.dentalChart!.date_charted).toISOString().slice(0, 10)) {
        extraWrites.push(apiClient.put(`/dental-charts/${savedChartId}`, { date_charted: draftChartDate }));
      }

      await Promise.all([...toothWrites, medWrite, dietWrite, oralWrite, ...extraWrites]);
      // Student Records' Status column and the Charting Queue's own status
      // both read /stats/student-rows -- without this, either would keep
      // showing this pupil's PRE-save pipeline stage until something else
      // happened to invalidate the cache (user, 2026-09-28: "status should
      // be real time... without refreshing the page").
      invalidateCached('/stats/student-rows');
      invalidateCached('/stats/student-nav');
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // The "Saved!" button label is an in-place echo for whoever is still
      // looking at the button — but it sits at the top of a long scrolling
      // form, so someone who edited teeth further down never sees it. The
      // toast is what actually confirms the save. One message, not four:
      // the writes above are a single user action, not four separate ones.
      toast.success('Chart saved.');
      // A charted student no longer belongs in the Dental Charts queue --
      // user, 2026-09-26: "when dental chart is marked or updated, the
      // queue should be gone" for that pupil. Harmless if they were never
      // queued (removeQueuedStudentId no-ops).
      removeQueuedStudentId(id);
      // Auto-queue for Treatment (user, 2026-09-28): any save that leaves
      // behind a charted tooth condition/treatment or a ticked oral health
      // condition queues this pupil for the Treatment submodule -- checked
      // against the SAVED state, not just this save's delta, so a chart
      // that already had decay marked queues again on every later save too.
      const hasChartOrOralConditionData =
        Object.values(draftChart).some((e) => e.condition || e.treatment) ||
        Object.values(draftOral).some((v) => v === true || (typeof v === 'string' && v.trim() !== ''));
      if (hasChartOrOralConditionData) addTreatmentQueueStudentId(id);
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
      // This page never mounts useStudents/useStudentNav's own reload path,
      // so a PUT here has to invalidate their shared caches directly (user,
      // 2026-09-27) -- otherwise Student Records or the next chart's own
      // Prev/Next nav would keep showing this student's PRE-edit name/grade/
      // section until the cache's safety-net TTL expired.
      invalidateCached('/stats/student-rows');
      invalidateCached('/stats/student-nav');
      await reload();
      toast.success('Student info updated.');
      setEditingInfo(false);
    } catch (err) {
      setInfoError(err instanceof ApiError ? err.message : 'Failed to update student info');
    } finally {
      setInfoSaving(false);
    }
  };

  const chartedConditionCount = Object.values(currentChart).filter((e) => e.condition).length;
  const chartedTreatmentCount = Object.values(currentChart).filter((e) => e.treatment).length;
  // Tooth Treatment Codes hides once no tooth carries a condition (below) --
  // an armed selectedTreatment would otherwise still apply on the next
  // tooth click even while its own palette (and "Click teeth to apply" hint)
  // is off screen. Cleared the instant the palette itself would hide.
  useEffect(() => {
    if (chartedConditionCount === 0) setSelectedTreatment(null);
  }, [chartedConditionCount]);

  // Clears one vocabulary across every tooth, leaving the other untouched.
  // Draft-only: nothing reaches the DB until Save, so Cancel still undoes it.
  const clearAll = (field: 'condition' | 'treatment') => {
    const next: Record<number, ChartEntry> = {};
    Object.entries(currentChart).forEach(([tooth, entry]) => {
      next[Number(tooth)] = { ...entry, [field]: '' };
    });
    setDraftChart(next);
    // Same live re-derivation as a single tooth paint/erase -- clearing
    // every condition at once can just as easily be the thing that empties
    // the last real content behind a date.
    syncDatesFromChart(next);
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
  // Was: 'default' fell through to the same '/dental-charts' as the queue
  // context (user, 2026-09-27) -- opened from Student Records, Back must
  // return to Student Records, not the Dental Charts queue it never came
  // from.
  const backPath =
    iptrContext === 'risk' ? '/ai-analytics'
    : iptrContext === 'treatment' ? '/treatment-records'
    : iptrContext === 'dental-queue' ? '/dental-charts'
    : '/patients';

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
                ['Age', patientAge === null ? '—' : `${patientAge} years`],
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
                // BUG-13: permanent (DMFT) and deciduous (dmft) stay separate, as in the
                // DMFT History table. 0 when nothing is charted (user, 2026-09-25).
                const yrDmftLabel = `DMFT ${yrDmft.T} · dmft ${yrDmft.t}`;
                const isActive = selectedYear === idx;
                // Marks the actual current school year regardless of which
                // year is SELECTED (user, 2026-09-28: "highlight or maybe a
                // label that emphasize the current school year") -- a solid
                // green pill around the year label itself, so it reads at a
                // glance even when a different (older) year is the one being
                // viewed, distinct from the blue selected-tab styling above.
                const isCurrentYear = y.iptr.school_year === schoolYearLabel();
                return (
                  <div key={y.iptr._id} className={`mr-1 flex flex-shrink-0 items-stretch border-b-2 ${isActive ? 'border-blue-700 bg-blue-50 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-gray-50'}`}>
                    <button type="button" onClick={() => { setSelectedYear(idx); setSelectedChartId(null); setExplicitVisit(null); }} className="px-4 py-2.5 text-left text-xs font-medium transition-all">
                      {isCurrentYear ? (
                        <span className="inline-block rounded-full bg-emerald-600 px-2 py-0.5 text-white">{y.iptr.school_year}</span>
                      ) : (
                        <div>{y.iptr.school_year}</div>
                      )}
                      {activeTab === 'chart' && (
                        <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'} >{yrDmftLabel}</div>
                      )}
                      <div style={{ fontSize: '10px', marginTop: '2px' }} className={isActive ? 'text-blue-600' : 'text-muted-foreground'}>
                        {formatDateStamp(examinedDate(y.oralCondition, y.dentalChart, y.toothRecords))}
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
        <div className="overflow-hidden rounded-xl border border-slate-300 bg-card shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
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
          <DentalChartTab
            chartingMode={chartingMode}
            student={student}
            yearGrade={yearGrade}
            yearSection={yearSection}
            navIndex={navIndex}
            navList={navList}
            prevPatient={prevPatient}
            nextPatient={nextPatient}
            canEdit={canEdit}
            canEditHistory={canEditHistory}
            editMode={editMode}
            saving={saving}
            saved={saved}
            chartError={chartError}
            dateOrderError={dateOrderError}
            editingChart={editingChart}
            editingHistory={editingHistory}
            currentYearData={currentYearData}
            currentChart={currentChart}
            layoutContext={layoutContext}
            activeVisit={activeVisit}
            activeVisitRecord={activeVisitRecord}
            visitDateMin={visitDateMin}
            draftVisitHasData={draftVisitHasData}
            hasOralConditionMarked={hasOralConditionMarked}
            isOrallyFitChild={isOrallyFitChild}
            chartedConditionCount={chartedConditionCount}
            chartedTreatmentCount={chartedTreatmentCount}
            dmft={dmft}
            presentOralConditions={presentOralConditions}
            indicateNumberRows={indicateNumberRows}
            perToothTreatmentRows={perToothTreatmentRows}
            visit1HasDataLive={visit1HasDataLive}
            treatmentTeethVisit1={treatmentTeethVisit1}
            treatmentTeethVisit2={treatmentTeethVisit2}
            actions={{
              setChartingMode, goToStudent, setEditMode, cancelEdit, handleSave, setExplicitVisit, setConfirmClear,
              handleToothPointerDown, syncChartDateFromConditions, syncVisitDateFromServices,
            }}
            palette={{
              selectedCondition, setSelectedCondition, selectedTreatment, setSelectedTreatment,
              rareConditionsOpen, setRareConditionsOpen,
            }}
            drafts={{
              draftVisitDate, setDraftVisitDate, draftVisitDateByVisit, draftServices, setDraftServices,
              draftServicesByVisit, draftChartDate, setDraftChartDate, draftOral, setDraftOral,
              othersOralOpen, setOthersOralOpen,
            }}
          />
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
                <input type="text" readOnly disabled value={draftInfo.birthday ? (computeAge(String(draftInfo.birthday).slice(0, 10), new Date()) ?? '') : ''} placeholder="Automatically calculated" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-not-allowed bg-muted text-muted-foreground" />
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
        onConfirm={() => { const t = pendingNav; setPendingNav(null); setEditMode(false); if (t) navigate(`/dental-chart/${t.id}${navQuery}`); }}
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
