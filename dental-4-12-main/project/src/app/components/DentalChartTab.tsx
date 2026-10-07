import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Save, Pencil, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check, AlertTriangle, Lock, Minimize2, Trash2, X, Undo2 } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { formatDate } from '../utils/localDate';
import { surnameFirst } from '../utils/studentName';
import type { ApiStudent, ApiPreventiveCareRecord } from '../api/types';
import type { IptrYearData } from '../hooks/useDentalChartData';
import type { StudentNavEntry } from '../hooks/useStudentNav';
import type { SectionBRow } from '../../../shared/iptrSectionB';
import { oralConditionChips, serviceChips, type OralDraft, type ServiceField } from './iptrDrafts';
import {
  upperPermanent,
  lowerPermanent,
  upperTemporary,
  lowerTemporary,
  temporaryTeeth,
  conditionColors,
  commonConditionCodes,
  rareConditionCodes,
  conditionCodes,
  treatmentCodes,
  perToothTreatmentCodes,
  treatmentLabel,
  type computeDMFT,
  type ChartEntry,
} from '../utils/dentalChartCodes';

// TAB 2 — the Dental Chart: the whole-mouth chips, the charting picker, the
// code palette, the odontogram, DMFT/dmft, and the two summaries.
//
// Sprint 162d, REDONE on the classmate's `majorUpdates` design (2026-09-30,
// after the merge). The JSX below was moved byte for byte by script from
// `DentalChart.tsx`, not retyped. So were `ToothButton`, `padToArch` and the
// module-level helpers only this panel uses. Every host value arrives under the
// host's own name, which is what let the JSX move without a single rename.
//
// ⚠ THE SCREEN A DENTIST ACTUALLY CHARTS IN. Every piece of state it touches
// stays in the HOST. The draft chart must survive switching tabs and is what
// Save Chart writes; the palette selection is what the host's
// `handleToothPointerDown` reads. Nothing moved into this file's own state, so
// nothing can reset on a tab switch that did not reset before.
//
// ⚠ `ToothButton` is declared INSIDE the component, exactly as it was in the
// host. That makes it a new component type each render (all 52 teeth remount),
// which the first 162d hoisted out. It is NOT hoisted here on purpose: her
// paint-stroke charting (pointerdown + `data-tooth` + drag) is a touch
// interaction this pure move must not change the timing of. Hoist it as its own
// change, tested on a tablet.
//
// The seam, as in the other tabs: read-only values are plain props; what the
// panel can CHANGE arrives in three bundles — `actions` (host handlers),
// `palette` (which code is armed), `drafts` (the chips, services and dates).

type StepTarget = { id: string; name: string };

// Palette buttons (user's pick "E", 2026-09-24, replacing the taller
// labeled "A"): small code-only buttons in the palette font (DejaVu Sans, see
// theme.css --font-palette). The meaning of the SELECTED code shows in the
// one "click teeth to apply" line under the row; the full label is also on
// each button's tooltip and in the Legend.
// Plain bold (user, 2026-09-24): regular read too light, bold plus a stroke too heavy.
const paletteBtn = 'h-10 min-w-[52px] shrink-0 rounded-md border px-3 text-center font-palette text-sm font-bold leading-none transition-all inline-flex items-center justify-center';
// ✓ reads the same permanent and temporary, so it shows once, not "✓/✓".
const conditionCodeText = (c: { perm: string; temp: string }) => (c.perm === c.temp ? c.perm : `${c.perm}/${c.temp}`);

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

export interface ChartTabActions {
  setChartingMode: (on: boolean) => void;
  goToStudent: (target: StepTarget | null) => void;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  cancelEdit: () => Promise<void>;
  handleSave: () => Promise<void>;
  setExplicitVisit: Dispatch<SetStateAction<1 | 2 | null>>;
  setConfirmClear: Dispatch<SetStateAction<'condition' | 'treatment' | null>>;
  /** What pressing a tooth MEANS — owned by the host, which owns the draft. */
  handleToothPointerDown: (toothNumber: number) => void;
  syncChartDateFromConditions: (oral: OralDraft, othersOpen: boolean) => void;
  syncVisitDateFromServices: (services: Record<ServiceField, boolean | null>) => void;
}

/** Select the teeth first, then pick a code from the popup (user, 2026-10-07). */
export interface ChartTabMarking {
  markType: 'condition' | 'treatment';
  changeMarkType: (type: 'condition' | 'treatment') => void;
  selectedTeeth: Set<number>;
  codesOpen: boolean;
  closeCodes: () => void;
  applyCode: (kind: 'condition' | 'treatment', key: string) => void;
  toggleToothFromKeyboard: (tooth: number) => void;
  canUndo: boolean;
  undoMark: () => void;
  rareOpen: boolean;
  setRareOpen: Dispatch<SetStateAction<boolean>>;
}

export interface ChartTabDrafts {
  draftVisitDate: string;
  setDraftVisitDate: (next: string | ((prev: string) => string)) => void;
  draftVisitDateByVisit: Record<1 | 2, string>;
  draftServices: Record<ServiceField, boolean | null>;
  setDraftServices: (next: Record<ServiceField, boolean | null>) => void;
  draftServicesByVisit: Record<1 | 2, Record<ServiceField, boolean | null>>;
  draftChartDate: string;
  setDraftChartDate: Dispatch<SetStateAction<string>>;
  draftOral: OralDraft;
  setDraftOral: Dispatch<SetStateAction<OralDraft>>;
  othersOralOpen: boolean;
  setOthersOralOpen: Dispatch<SetStateAction<boolean>>;
}

export function DentalChartTab({
  chartingMode,
  student,
  yearGrade,
  yearSection,
  navIndex,
  navList,
  prevPatient,
  nextPatient,
  canEdit,
  canEditHistory,
  editMode,
  saving,
  saved,
  chartError,
  dateOrderError,
  editingChart,
  editingHistory,
  currentYearData,
  currentChart,
  layoutContext,
  activeVisit,
  activeVisitRecord,
  visitDateMin,
  draftVisitHasData,
  hasOralConditionMarked,
  isOrallyFitChild,
  chartedConditionCount,
  chartedTreatmentCount,
  dmft,
  presentOralConditions,
  indicateNumberRows,
  perToothTreatmentRows,
  visit1HasDataLive,
  treatmentTeethVisit1,
  treatmentTeethVisit2,
  actions,
  drafts,
  marking,
}: {
  chartingMode: boolean;
  student: ApiStudent;
  yearGrade: string | null;
  yearSection: string | null;
  navIndex: number;
  navList: StudentNavEntry[];
  prevPatient: StudentNavEntry | null;
  nextPatient: StudentNavEntry | null;
  canEdit: boolean;
  canEditHistory: boolean;
  editMode: boolean;
  saving: boolean;
  saved: boolean;
  chartError: string | null;
  dateOrderError: string | null;
  editingChart: boolean;
  editingHistory: boolean;
  currentYearData: IptrYearData | undefined;
  currentChart: Record<number, ChartEntry>;
  layoutContext: 'default' | 'risk';
  activeVisit: 1 | 2;
  activeVisitRecord: ApiPreventiveCareRecord | undefined;
  visitDateMin: string;
  draftVisitHasData: (n: 1 | 2) => boolean;
  hasOralConditionMarked: boolean;
  isOrallyFitChild: boolean;
  chartedConditionCount: number;
  chartedTreatmentCount: number;
  dmft: ReturnType<typeof computeDMFT>;
  presentOralConditions: { label: string; present: boolean }[];
  indicateNumberRows: SectionBRow[];
  perToothTreatmentRows: typeof treatmentCodes;
  visit1HasDataLive: boolean;
  treatmentTeethVisit1: Record<string, number[]>;
  treatmentTeethVisit2: Record<string, number[]>;
  actions: ChartTabActions;
  drafts: ChartTabDrafts;
  marking: ChartTabMarking;
}) {
  const { markType, changeMarkType, selectedTeeth, codesOpen, closeCodes, applyCode, toggleToothFromKeyboard, canUndo, undoMark, rareOpen, setRareOpen } = marking;
  const {
    setChartingMode, goToStudent, setEditMode, cancelEdit, handleSave, setExplicitVisit, setConfirmClear,
    handleToothPointerDown, syncChartDateFromConditions, syncVisitDateFromServices,
  } = actions;
  const {
    draftVisitDate, setDraftVisitDate, draftVisitDateByVisit, draftServices, setDraftServices,
    draftServicesByVisit, draftChartDate, setDraftChartDate, draftOral, setDraftOral,
    othersOralOpen, setOthersOralOpen,
  } = drafts;

  // Where the code popup sits: centred over the selected teeth, above them when
  // there is room inside the chart and below otherwise.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  // Phones: the popup is a bottom sheet, not something pinned beside a tooth inside
  // a sideways-scrolling chart.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pop = popRef.current;
    if (narrow || !stage || !pop || !codesOpen || selectedTeeth.size === 0) { setPopPos(null); return; }
    const sr = stage.getBoundingClientRect();
    const rects = [...selectedTeeth]
      .map((n) => stage.querySelector<HTMLElement>(`[data-tooth="${n}"]`)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r);
    if (rects.length === 0) { setPopPos(null); return; }
    const top = Math.min(...rects.map((r) => r.top)) - sr.top;
    const bottom = Math.max(...rects.map((r) => r.bottom)) - sr.top;
    const cx = (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2 - sr.left;
    // Kept inside the VIEWPORT (not the chart box): centred on the selection, above
    // it when that fits on screen and below it otherwise.
    const left = Math.max(8 - sr.left, Math.min(cx - pop.offsetWidth / 2, window.innerWidth - 8 - pop.offsetWidth - sr.left));
    const above = top - pop.offsetHeight - 10;
    setPopPos({ left, top: sr.top + above >= 8 ? above : bottom + 10 });
  }, [codesOpen, selectedTeeth, markType, rareOpen, currentChart, narrow]);

  // True when EVERY selected tooth already carries this code (the popup shows it
  // pressed, and choosing it again removes it).
  const allHave = (kind: 'condition' | 'treatment', key: string) => {
    if (selectedTeeth.size === 0) return false;
    const codeObj = kind === 'condition' ? conditionCodes.find((c) => c.code === key) : undefined;
    return [...selectedTeeth].every((n) => {
      const e = currentChart[n];
      if (kind === 'treatment') return e?.treatment === key;
      return e?.condition === (codeObj ? (temporaryTeeth.has(n) ? codeObj.temp : codeObj.perm) : key);
    });
  };

  const ToothButton = ({ num }: { num: number }) => {
    const data = currentChart[num];
    const cond = data?.condition || '';
    const treat = data?.treatment || '';
    const colorClass = conditionColors[cond] || conditionColors[cond.toLowerCase()] || 'bg-card border-border';
    const picked = selectedTeeth.has(num);
    const dimmed = editingChart && markType === 'treatment' && !cond;
    const isSelected = editingChart && !dimmed;
    const hoverClass = isSelected
      ? 'hover:border-amber-500 cursor-pointer'
      : dimmed ? 'cursor-not-allowed opacity-40' : 'cursor-default';
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
        onClick={(e) => { if (e.detail === 0 && editingChart) toggleToothFromKeyboard(num); }}
        aria-pressed={picked}
        // touch-action: none stops the browser from treating a chairside drag
        // across teeth as a page scroll, which is exactly what a paint stroke
        // looks like to a touchscreen otherwise.
        style={{ touchAction: 'none' }}
        // Grows to fill the card instead of leaving ~100px of slack on each
        // side, capped so the boxes stay tooth-shaped rather than becoming wide
        // rectangles on a large screen. flex-1 is also what keeps the primary
        // row aligned with the permanent one -- both rows are 16 equal slots.
        className={`relative flex h-[52px] min-w-[40px] max-w-[56px] flex-1 flex-col items-center justify-between rounded-md border-2 px-0.5 py-1 text-center transition-all md:h-[64px] ${colorClass} ${hoverClass} ${picked ? 'outline outline-[3px] outline-offset-1 outline-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.25)]' : ''}`}
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

  return (
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
      <div className="space-y-4">
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
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-card shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
      {/* View-mode notice INSIDE the bar (option "B", 2026-09-25): the
          bar itself still greys out when not editable -- that is the
          point of the grey/navy toggle -- and the hint plus a solid
          red VIEW MODE pill sit on the right, both in red, taking no
          extra row. */}
      <div className={`flex items-center gap-3 px-4 py-2 text-[13px] font-semibold uppercase tracking-wider ${editingHistory ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600'}`}>
        <span>Oral Conditions &amp; Treatments Given</span>
        {!editingHistory && (
          <>
            <span className="ml-auto text-[12px] font-normal normal-case tracking-normal text-destructive">
              {canEditHistory ? 'Click the pencil icon above to record conditions/treatments.' : 'View only. Editing restricted to Dentist and Dental Aide.'}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[12.5px] font-semibold normal-case tracking-normal text-white">
              <Lock className="h-3 w-3" /> View Mode
            </span>
          </>
        )}
      </div>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={editingHistory ? '' : 'opacity-60 pointer-events-none select-none'}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <div className="text-base font-bold text-primary uppercase tracking-wide">Oral Conditions</div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Date examined
              {/* Enabled whenever a whole-mouth chip OR any tooth
                  condition is present (2026-09-28 fix) -- a mouth
                  charted tooth-by-tooth with no chip ticked still
                  counts as examined. */}
              <input type="date" value={draftChartDate} disabled={!(oralConditionChips.some(({ field }) => draftOral[field]) || othersOralOpen || Object.values(currentChart).some((e) => e.condition))}
                onChange={(e) => setDraftChartDate(e.target.value)}
                title="Filled in when an oral condition is ticked or a tooth condition is charted"
                className="border border-border rounded px-2 py-1 text-sm bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring" />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
            {oralConditionChips.map(({ label, field }) => (
              <label key={field}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${draftOral[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                <input type="checkbox" checked={!!draftOral[field]}
                  onChange={(e) => {
                    const next = { ...draftOral, [field]: e.target.checked };
                    setDraftOral(next);
                    syncChartDateFromConditions(next, othersOralOpen);
                  }}
                  className="w-5 h-5 rounded accent-primary" />
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
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${othersOralOpen ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
              <span className={`w-5 h-5 rounded border shrink-0 flex items-center justify-center ${othersOralOpen ? 'bg-primary border-primary' : 'border-gray-600'}`}>
                {othersOralOpen && <Check className="w-3 h-3 text-white" />}
              </span>
              Others
            </button>
          </div>
          {othersOralOpen && (
            <div className="mt-3 rounded-lg bg-canvas p-3">
              <label className="block text-sm font-bold text-foreground mb-1">Specify Other</label>
              <input type="text" value={draftOral.others}
                onChange={(e) => setDraftOral((prev) => ({ ...prev, others: e.target.value }))}
                placeholder="Specify other oral condition…"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}
        </div>

        {/* The WHOLE column -- title, Date treated, Visit 1/2, and the
            checkboxes -- hidden until an Oral Condition (or a Tooth
            Condition Code) is marked, not just the checkbox grid
            (user, 2026-09-28: "Treatments Given / Date treated / Visit
            1 / Visit 2 ... these words too should be hidden and only
            show when there are changes"). Same hasOralConditionMarked
            as the grid below already used. */}
        {hasOralConditionMarked && (
        <div className="border-t border-border pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:border-border lg:pl-4">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <div className="text-base font-bold text-primary uppercase tracking-wide">Treatments Given</div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Date treated
              {/* Only editable once THIS visit has something ticked or
                  charted (user, 2026-09-28: "the date can only be
                  edited in the oral condition when there is marked
                  filled, it should be the same with the treatment
                  given date") -- same rule as Date examined above,
                  reusing the same live per-visit check the Visit 2
                  button itself watches. */}
              <input type="date" value={draftVisitDate} disabled={!editingChart || !draftVisitHasData(activeVisit)} min={visitDateMin || undefined}
                title={!draftVisitHasData(activeVisit) ? 'Filled in when a service is ticked or a tooth is charted for this visit' : visitDateMin ? `Can't be before ${formatDate(visitDateMin)}` : undefined}
                onChange={(e) => setDraftVisitDate(e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring" />
            </label>
            {/* Visit 1 / Visit 2 (2026-09-25, reworked 2026-09-28 x4),
                right-aligned on this same row. Visit 1 is ALWAYS
                visible -- a student pending their first visit still needs
                a tab to land on. Visit 2 only appears once Visit 1 has
                REAL content, read LIVE off the draft (visit1HasDataLive,
                2026-09-28 fix -- "it should be real time ... the moment
                that visit 1 is empty, it should hide the visit 2 button
                automatically": the saved-data version only caught up
                after Save, so unchecking Visit 1's last box mid-edit
                left the button showing until the page reloaded). Visit
                1's record is exempt from archiving, so it can go back
                to empty and still technically exist -- that is exactly
                the case this hides, live. Never carries a "+" prefix --
                the default (no explicit pick) is Visit 2 once it can
                show, since recording Visit 1 makes Visit 2 the next
                thing to do. Deliberately OUTSIDE the view-mode
                pointer-events-none wrapper below (user, 2026-09-28:
                "the Visit 1 and Visit 2 shouldnt be locked in the view
                mode, so we can still view records") -- switching which
                visit's data is on screen is a READ action, not an
                edit, and view mode only needs to block the latter. */}
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => setExplicitVisit(1)}
                className={`px-2.5 py-1 text-sm font-semibold rounded-full border transition-colors ${
                  activeVisit === 1
                    ? 'border-primary bg-primary text-white'
                    : 'border-border text-muted-foreground hover:bg-canvas'
                }`}>
                Visit 1
              </button>
              {visit1HasDataLive && (
                <button type="button" onClick={() => setExplicitVisit(2)}
                  className={`px-2.5 py-1 text-sm font-semibold rounded-full border transition-colors ${
                    activeVisit === 2
                      ? 'border-primary bg-primary text-white'
                      : 'border-border text-muted-foreground hover:bg-canvas'
                  }`}>
                  Visit 2
                </button>
              )}
            </div>
          </div>
          <div className={editingChart ? '' : 'opacity-60 pointer-events-none select-none'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
              {serviceChips.map(({ label, field }) => (
                <label key={field}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${draftServices[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-blue-200 text-foreground hover:bg-canvas'}`}>
                  {/* Unticking writes null, not false — see the state above. */}
                  <input type="checkbox" checked={draftServices[field] === true}
                    onChange={(e) => {
                      const next = { ...draftServices, [field]: e.target.checked ? true : null };
                      setDraftServices(next);
                      syncVisitDateFromServices(next);
                    }}
                    className="w-5 h-5 rounded accent-primary" />
                  {label}
                </label>
              ))}
            </div>
            {/* Unlocked 2026-09-25 -- ticking a service here now creates
                the active visit's RPC record on save instead of
                requiring one to already exist. Shown only pre-save so it
                doesn't linger once the visit is real. */}
            {!activeVisitRecord && (
              <p className="mt-2 text-[12px] italic text-muted-foreground">
                Recording a service or charting a treatment creates this school year's Visit {activeVisit} when you save.
              </p>
            )}
          </div>
        </div>
        )}
      </div>
      </div>

      {chartError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-danger-surface px-3 py-2 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span>{chartError}</span>
        </div>
      )}

      {/* Live, not save-time (user, 2026-09-28: "this warning should be
          real time to changes too. it should show and hide when
          necessary") -- recomputed from the current draft on every
          render via computeDateOrderError, so it appears the instant a
          typed date violates the ordering rule and disappears the
          instant it no longer does, with no Save click either way. */}
      {dateOrderError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-danger-surface px-3 py-2 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span>{dateOrderError}</span>
        </div>
      )}

      {/* Not scrollable from md up (user, 2026-10-07): the code popup must be able to extend
          past the box. Below md the 16-tooth rows need a sideways scroll to stay tooth-sized. */}
      <div className="relative bg-card rounded-xl border border-slate-300 p-4 max-md:overflow-x-auto shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        {/* Condition | Treatment switch, in the chart's empty top-left corner (user,
            2026-10-07). Above the chart below xl, where there is no free corner. */}
        {editingChart && (
          <div className="mb-3 flex flex-wrap items-center gap-2 xl:absolute xl:left-4 xl:top-4 xl:z-10 xl:mb-0 xl:w-[165px] xl:flex-col xl:items-start">
            <div role="group" aria-label="Mark as" className="inline-flex overflow-hidden rounded-[10px] border border-border bg-card">
              <button type="button" aria-pressed={markType === 'condition'} onClick={() => changeMarkType('condition')}
                className={`px-2.5 py-1.5 text-[12.5px] font-bold transition-colors ${markType === 'condition' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'}`}>Condition</button>
              <button type="button" aria-pressed={markType === 'treatment'} onClick={() => changeMarkType('treatment')} disabled={chartedConditionCount === 0}
                title={chartedConditionCount === 0 ? 'Chart a condition on a tooth first' : undefined}
                className={`px-2.5 py-1.5 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${markType === 'treatment' ? 'bg-blue-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>Treatment</button>
            </div>
            {(markType === 'condition' ? chartedConditionCount : chartedTreatmentCount) > 0 && (
              <button type="button" onClick={() => setConfirmClear(markType)}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold text-foreground transition-all hover:border-red-400 hover:text-destructive">
                <Trash2 className="h-3 w-3" /> Clear All ({markType === 'condition' ? chartedConditionCount : chartedTreatmentCount})
              </button>
            )}
            {canUndo && (
              <button type="button" onClick={undoMark}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold text-foreground hover:border-primary">
                <Undo2 className="h-3 w-3" /> Undo last
              </button>
            )}
          </div>
        )}
        {/* Every row is 16 equal slots, so a primary tooth sits directly
            under the permanent tooth it will replace: 55↔15, 54↔14 …
            51↔11, 61↔21 … 65↔25 (FDI). The primary rows previously used
            `5 teeth + a w-9 midline spacer + 5 teeth`, centred — but the
            permanent row has no midline gap (11 and 21 are adjacent), so
            the spacer pushed both halves outward and nothing lined up.
            Three blank slots at each end replace it, and alignment now
            holds at any tooth size because both rows flex identically. */}
        <div ref={stageRef} className="relative min-w-[680px] space-y-2.5">
          {/* DOH IPTR form order: temporary arches on the outside (rows 1
              and 4), permanent arches on the inside (rows 2 and 3). */}
          <div className="flex justify-center gap-1">{padToArch(upperTemporary)}</div>
          <div className="flex justify-center gap-1">{upperPermanent.map((n) => <ToothButton key={n} num={n} />)}</div>
          <div className="border-t-2 border-dashed border-border my-2" />
          <div className="flex justify-center gap-1">{lowerPermanent.map((n) => <ToothButton key={n} num={n} />)}</div>
          <div className="flex justify-center gap-1">{padToArch(lowerTemporary)}</div>
          {editingChart && codesOpen && selectedTeeth.size > 0 && (
            <div ref={popRef} role="dialog" aria-label="Codes for the selected teeth"
              style={narrow ? undefined : { left: popPos?.left ?? 0, top: popPos?.top ?? 0, visibility: popPos ? 'visible' : 'hidden' }}
              className={`z-50 rounded-xl border border-border bg-card p-3 shadow-[0_12px_32px_rgba(15,23,42,0.22)] ${narrow
                ? 'fixed inset-x-3 bottom-3 max-h-[60vh] overflow-y-auto'
                : 'absolute w-max max-w-[min(360px,calc(100vw-2rem))]'}`}>
              <div className="mb-2 flex items-center gap-2 text-[13px]">
                <b className="text-foreground">{selectedTeeth.size} {selectedTeeth.size === 1 ? 'tooth' : 'teeth'} selected</b>
                <span className="text-muted-foreground">{markType === 'condition' ? 'Tooth Condition Codes' : 'Tooth Treatment Codes'}</span>
                <button type="button" onClick={closeCodes} aria-label="Close" className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              {markType === 'condition' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {commonConditionCodes.map((c) => (
                    <button key={c.code} type="button" title={c.label} onClick={() => applyCode('condition', c.code)}
                      className={`${paletteBtn} ${allHave('condition', c.code) ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                      {c.perm === '✓' ? <span className="text-2xl leading-none">✓</span> : conditionCodeText(c)}
                    </button>
                  ))}
                  <button type="button" onClick={() => setRareOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                    {rareOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    More ({rareConditionCodes.length})
                  </button>
                  {rareOpen && (
                    <div className="mt-1 flex basis-full flex-wrap gap-1.5">
                      {rareConditionCodes.map((c) => (
                        <button key={c.code} type="button" title={c.label} onClick={() => applyCode('condition', c.code)}
                          className={`${paletteBtn} ${allHave('condition', c.code) ? 'bg-teal-600 text-white ring-2 ring-teal-300 border-teal-600' : 'bg-card border-border text-foreground hover:border-teal-400'}`}>
                          {conditionCodeText(c)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {perToothTreatmentCodes.map((t) => (
                    <button key={t.code} type="button" title={treatmentLabel(t)} onClick={() => applyCode('treatment', t.code)}
                      className={`${paletteBtn} ${allHave('treatment', t.code) ? 'bg-blue-600 text-white ring-2 ring-blue-300 border-blue-600' : 'bg-card border-border text-foreground hover:border-blue-400'}`}>
                      {t.code}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
              // Both visits' drafts are always live now (per-visit
              // slots, not one shared "whichever tab is active" slot),
              // so this table reads them directly for either column --
              // it no longer needs to fall back to the last-SAVED
              // record for the visit not currently on screen.
              const visitCol = (n: 1 | 2) => ({ date: draftVisitDateByVisit[n], services: draftServicesByVisit[n] });
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
  );
}
