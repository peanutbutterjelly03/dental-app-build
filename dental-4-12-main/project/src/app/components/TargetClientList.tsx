import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TOPBAR_H } from '../utils/layout';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import type { ApiStudent, ApiOralHealthCondition, ApiStudentIptr } from '../api/types';
import { useStudents } from '../hooks/useStudents';
import { useRPCTracking, SOUND_TEMPORARY, SOUND_PERMANENT } from '../hooks/useRPCTracking';
import type { VisitServices } from '../../../shared/rpcTracking';
import { SkeletonTable } from './Skeleton';
import { Calendar, CalendarDays, CalendarRange, Clock } from 'lucide-react';
import { PanelShell, PanelRow, GroupBox, Underlined, PeriodSwitch, fieldInputClass, ActionGroup, ExportMenu, BOX_W } from './ReportControls';
import { RangePicker } from './RangePicker';
import { downloadBlob } from '../utils/exportCsv';
import { formatDate, toLocalDateString } from '../utils/localDate';
import { buildSheetsXlsx } from '../utils/exportXlsx';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { useGridScroll } from '../hooks/useGridScroll';
import { GridEdgeButtons } from './GridEdgeButtons';
import { PreviewModal } from './PreviewModal';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { buildPagesPdf } from '../utils/exportPdf';
import { ageOn, ageBracketIndex, DOH_AGE_BRACKETS } from '../../../shared/age';
import { cariesStatus } from '../../../shared/cariesStatus';

// ─── Target Client List for Oral Health Care and Services ────────────────────
// Transcribed from the manuscript's APPENDIX E (not D — Appendix D is the DMFX
// Index Score). The appendix is a low-resolution scan of the paper DOH form, so
// the column set below was read off it directly; three labels were illegible
// and are marked in the header definitions.
//
// HONESTY NOTE — several columns are rendered but CANNOT be filled from the
// current data model, and are deliberately left blank rather than faked:
// PREVENTIVE_CARE_RECORD stores per-visit DATE, NUMBER and (since Sprint 81)
// facility_based, but no per-visit SERVICE. That means the FIRST/SECOND
// service columns (oral hygiene instruction, counselling, oral prophylaxis,
// fluoride varnish, complete RPC) still have no source. The visit DATES are
// real, and so are the curative treatment codes.
//
// Sprint 82 added the columns the real form has and this table did not, using
// the missing-column list Sprint 80 read off the DOH workbook
// (TCLForm2andFHSISReport.xlsx). Which of them carry REAL data:
//   * Facility Based (column C) — real, from Sprint 81's facility_based.
//   * Pit and Fissure Sealant / Temporary Filling (Tooth Count) — real TOOTH
//     COUNTS from TOOTH_RECORD, not just "ever had it".
//   * Orally Fit Child, Upon Oral Examination — real, the same oralStatus the
//     dashboard and the Program Report's OFC row read.
//   * Last / Next Dental Visit — real, from APPOINTMENT (split on now).
// Blank because nothing records them: Family Serial Number, Barangay (STUDENT
// has no such fields — address is one free-text line), Complete Mouth Rehab,
// Orally Fit After Complete Mouth Rehabilitation.
//
// ⚠ Two column-set corrections, both from the workbook, NOT invented here:
//   * `Gum Treatment` was ONE guessed column; the form has TWO (Scaling,
//     Prescription). Split, which removes an `unverified` flag rather than
//     adding one.
//   * `Complete Health Record` was REMOVED — Sprint 80 established it does not
//     exist on the real form at all. This is the one deletion; every other
//     column stays even when empty, per CLAUDE.md.
//
// ⚠ NOT VERIFIABLE ON THIS MACHINE: the workbook lives in per-device `data/`
// and was supplied to the other laptop, so the "66 columns" total could not be
// re-counted here. The additions follow HANDOFF's written list from the
// session that DID read the file. Re-check the count against the workbook
// before treating this table as complete.

// The form's printed bracket labels — the shared DOH set (BUG-02), not a copy.
const AGE_GROUPS: readonly string[] = DOH_AGE_BRACKETS;

type Period = 'range' | 'monthly' | 'quarterly' | 'half' | 'annual';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Inclusive start / exclusive end for the period containing `anchor`.
 *  Built from local date parts, not UTC — a consultation is filed under the
 *  clinic's calendar day, which is the same reason `toLocalDateString` exists. */
function periodRange(anchor: string, period: Period, rangeStart: string, rangeEnd: string): { start: Date; end: Date; label: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  const startOfDay = new Date(y, m - 1, d);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtMon = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  if (period === 'range') {
    const [sy, sm, sd] = rangeStart.split('-').map(Number);
    const [ey, em, ed] = rangeEnd.split('-').map(Number);
    const first = new Date(sy, sm - 1, sd);
    // End is exclusive: a one-day range is [that day, the next day).
    return { start: first, end: new Date(ey, em - 1, ed + 1), label: rangeStart === rangeEnd ? fmt(first) : `${fmt(first)} to ${fmt(new Date(ey, em - 1, ed))}` };
  }
  if (period === 'monthly') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { start, end, label: fmtMon(start) };
  }
  if (period === 'quarterly') {
    const qStart = Math.floor((m - 1) / 3) * 3;
    const start = new Date(y, qStart, 1);
    const end = new Date(y, qStart + 3, 1);
    return { start, end, label: `${fmtMon(start)} to ${fmtMon(new Date(y, qStart + 2, 1))}` };
  }
  if (period === 'half') {
    const hStart = m <= 6 ? 0 : 6;
    const start = new Date(y, hStart, 1);
    return { start, end: new Date(y, hStart + 6, 1), label: `${fmtMon(start)} to ${fmtMon(new Date(y, hStart + 5, 1))}` };
  }
  const start = new Date(y, 0, 1);
  const end = new Date(y + 1, 0, 1);
  return { start, end, label: String(y) };
}

/** Age AT THE DATE OF CONSULTATION, which is what the form's Age column means
 *  and what its Age Group column is banded on (Sprint 57b). Computed to "today"
 *  before, so re-opening a filed period silently aged every client and could
 *  move them into a different age group than was reported. Falls back to today
 *  only for a client with no recorded consultation — who is filtered out of
 *  every period anyway. */
const ageFrom = (birthdate: string, on: string | null = null) => {
  const t = on ? new Date(on) : new Date();
  if (Number.isNaN(t.getTime())) return null;
  return ageOn(birthdate, t); // BUG-02: the one age rule
};

const ageGroupOf = (age: number | null) => {
  const i = ageBracketIndex(age);
  return i === null ? '' : AGE_GROUPS[i];
};

/** A column that exists on the paper form but has no data behind it yet. */
const NO_SOURCE = '—';

/** The paper form's service columns, in printed order.
 *
 *  The FIRST and SECOND visit blocks are IDENTICAL on the form — it repeats the
 *  whole preventive set for the second visit. An earlier version rendered only
 *  the two SECOND columns that had data, which made the sheet stop matching the
 *  form. All of them are rendered now, blank where there is no source.
 *
 *  `value` reads a row; a column WITHOUT one has no source in the data model
 *  (PREVENTIVE_CARE_RECORD stores only iptr_id, visit_date and visit_number, so
 *  no per-visit service is recorded anywhere) and renders "—".
 *
 *  ⚠ `unverified` NOW FLAGS NOTHING — every caption in this list is verified
 *  (Sprint 103). The mechanism is kept because the next form transcribed from a
 *  scan will need it, and both the dotted underline and the note above the table
 *  self-hide at zero. Do NOT re-add a flag without saying which source settled
 *  it. History: most were resolved on
 *  2026-09-02 against the machine-readable DOH workbook the user supplied
 *  (TCLForm2andFHSISReport.xlsx, sheet "6-9 Y.O (M)" row 4) -- the authoritative
 *  source that replaced the low-resolution Appendix E scan. Corrections made:
 *  "Completed BPOC" -> "Complete RPC for 1st Visit Routine Preventative Care"
 *  (the app had invented an acronym), "Referral" -> "Referred Out", and the 2nd
 *  SDF application is a TOOTH COUNT, not a yes/no.
 *
 *  THREE REMAIN FLAGGED, deliberately -- the workbook does not settle them:
 *   - "Gum Treatment": the real form carries TWO columns, `Gum Treatment -
 *     Scaling` (BE) and `Gum Treatment - Prescription` (BF). Which one this
 *     single column means is a guess, so splitting it belongs with the missing-
 *     columns work, not here.
 *   - "Removal of Plaque / Calculus": the form's nearest column is `Oral
 *     Prophylaxis`, which this table already has separately.
 *   - "Complete Health Record": no such column exists on the real form at all.
 *
 *  Original note follows.
 *  ⚠ `unverified` marks a caption read off the low-resolution Appendix E scan
 *  that could not be made out with confidence. Shown with a dotted underline
 *  and counted in the note above the table. CHECK AGAINST THE PAPER FORM.
 *
 *  ⚠ STILL UNCHECKED, and NOT checkable on this machine: the 1st-visit caption
 *  says "Routine Preventative Care" while the 2nd says "Routine Preventive
 *  Care". One of those spellings is likely wrong, but settling it needs
 *  TCLForm2andFHSISReport.xlsx, which lives in the gitignored per-device
 *  `data/` folder and is on the OTHER laptop. Left exactly as transcribed
 *  rather than "corrected" by guess. */
type Row = {
  id: string;
  name: string;
  philhealth: string;
  address: string;
  contact: string;
  birthdate: string;
  age: number | null;
  ageGroup: string;
  sex: string;
  consultDate: string | null;
  risk: string | null;
  visit1Done: boolean;
  visit2Done: boolean;
  /** What was recorded AS DONE at each visit (Sprint 147), or null when the
   *  visit does not exist. ⚠ A null FIELD inside these means "not recorded" —
   *  the cell stays blank, it does not become a "no". */
  visit1Services: VisitServices | null;
  visit2Services: VisitServices | null;
  treatments: string[];
  /** Tooth counts per treatment code, for the form's tooth-count columns. */
  toothCounts: Record<string, number>;
  /** Tooth counts per CONDITION code — the form's d/f/x and D/M/F/X columns
   *  plus the two Sound counts. */
  conditions: Record<string, number>;
  /** Any permanent tooth charted, for the form's "5 Year Old with Permanent
   *  Dentition" column. FDI: permanent 11-48, primary 51-85. */
  /** ORAL_HEALTH_CONDITION for this student, or null when none is recorded —
   *  null renders "—" rather than "0", which would claim a negative finding
   *  where there was simply no examination. */
  oral: { gum: boolean; debris: boolean; calculus: boolean; anomaly: boolean } | null;
  /** Sprint 81's facility_based on the first visit. Null = not recorded. */
  /** Orally fit on examination — `useStudents`' own oralStatus, the same
   *  source the dashboard and the Program Report's OFC row read. */
  /** Most recent PAST and next FUTURE appointment, from APPOINTMENT. */
};
type ServiceCol = {
  group: 'ORAL HEALTH STATUS' | 'FIRST' | 'SECOND' | 'OTHER SERVICES' | 'ORALLY FIT CHILD';
  label: string;
  value?: (r: Row) => string;
  unverified?: boolean;
};

// ⚠ 'Oral Hygiene Instruction' is BACK (2026-09-06). It was removed on
// 2026-09-03 because the workbook's FIRST block is eight columns and has no
// such column — but the FILED SAMPLE the user supplied carries BOTH "Oral
// hygiene Instruction" AND "Counselling", in both FIRST and SECOND. The
// removal also quietly made "Counseling" print the oral-hygiene-instruction
// answer, so one recorded service was appearing under another service's name.
// PREVENTIVE_CARE_RECORD stores `oral_hygiene_instruction` and nothing for
// counselling, so instruction gets its data back and counselling renders blank
// — a column with no source, which is what the form's blank cell means.
/** ⚠ SPRINT 147 CHANGED WHERE THESE COLUMNS GET THEIR ANSWER.
 *
 *  They used to read the DENTAL CHART: "has this student ever had fluoride
 *  varnish?" — where the form asks "was fluoride varnish done AT THIS VISIT?".
 *  `PREVENTIVE_CARE_RECORD` stored no services at all, so there was nothing
 *  better to read, and `useRPCTracking` said so in its own comment. The visit
 *  now records what was done, so these read the visit.
 *
 *  ⚠ THREE STATES, NOT TWO. `null` on a service means NOT RECORDED — every
 *  visit created before Sprint 147, and anything the dentist left unanswered —
 *  and the cell stays BLANK. Only an explicit `false` is a "no", and the form
 *  prints a blank for that too (it is a tick-if-done column). A tick is only
 *  ever an explicit yes. */
const svcMark = (v: boolean | null | undefined) => (v === true ? '✓' : '');

const PREVENTIVE_SET = (visitDone: (r: Row) => boolean, isSecond: boolean): Omit<ServiceCol, 'group'>[] => {
  const svc = (r: Row): VisitServices | null => (isSecond ? r.visit2Services : r.visit1Services);
  return [
  // Falls back to "the visit happened" for records that predate the service
  // fields — an RPC visit always included a screening, and that is the one
  // service the visit's own existence evidences.
  { label: 'Oral screening', value: (r) => (svc(r)?.oralScreening === true || (svc(r)?.oralScreening == null && visitDone(r)) ? '✓' : '') },
  // ⚠ The form says "Moderate" where RISK_STRATIFICATION says "Medium"; the
  // visit stores the form's word. The `r.risk` fallback is the predictive
  // module's latest assessment, used only where the visit recorded none, and
  // only on the 1st visit as before.
  { label: 'Caries Risk assessment - Low', value: (r) => (svc(r)?.cariesRisk === 'Low' || (svc(r)?.cariesRisk == null && !isSecond && r.risk === 'Low') ? '✓' : '') },
  { label: 'Caries Risk assessment - Moderate', value: (r) => (svc(r)?.cariesRisk === 'Moderate' || (svc(r)?.cariesRisk == null && !isSecond && r.risk === 'Medium') ? '✓' : '') },
  { label: 'Caries Risk assessment - High', value: (r) => (svc(r)?.cariesRisk === 'High' || (svc(r)?.cariesRisk == null && !isSecond && r.risk === 'High') ? '✓' : '') },
  { label: 'Oral hygiene Instruction', value: (r) => svcMark(svc(r)?.oralHygieneInstruction) },
  // On the form, no source in Floral: PREVENTIVE_CARE_RECORD records the
  // instruction, not a separate counselling session.
  { label: 'Counselling' },
  { label: 'Oral Prophylaxis', value: (r) => (svc(r)?.oralProphylaxis === true || (svc(r)?.oralProphylaxis == null && !isSecond && r.treatments.includes('OP')) ? '✓' : '') },
  { label: 'Fluoride Varnish App', value: (r) => (svc(r)?.fluorideVarnish === true || (svc(r)?.fluorideVarnish == null && r.treatments.includes('FV')) ? '✓' : '') },
  // Sprint 103: the `unverified` flag on the 2nd-visit caption is REMOVED. The
  // FILLED PAPER SCAN settles it — "Complete RPC for 2nd Visit" is correct, and
  // the duplicated "1st" is a typo in the WORKBOOK (sheet "0-8 Months (M)" is
  // the only one of 27 carrying the right text). The workbook stays
  // authoritative on the column SET, but not on this one label.
  { label: isSecond ? 'Complete RPC for 2nd Visit Routine Preventive Care' : 'Complete RPC for 1st Visit Routine Preventative Care' },
  ];
};

/** The left-hand identity columns. Data-driven so they can be hidden like the
 *  service ones — the dentist's note was "Column - puede mahide", and half a
 *  hideable table would be worse than none.
 *
 *  `rotate` marks the narrow columns whose captions run bottom-to-top on the
 *  printed form; the wide ones keep horizontal captions. */
type IdentityCol = {
  key: string;
  label: string;
  rotate?: boolean;
  head?: ReactNode;
  value: (r: Row, i: number) => ReactNode;
  cls?: string;
};

/** ORAL HEALTH STATUS — workbook columns N–AG, twenty of them, and the app
 *  had NONE of them until 2026-09-03. Transcribed from
 *  `TCLForm2andFHSISReport.xlsx`, sheet "6-9 Y.O (M)", which the user supplied;
 *  the "0 - No 1 - Yes" suffix the workbook carries is dropped from the caption
 *  and expressed by rendering 1/0 rather than a tick, as the form does.
 *
 *  Caries EXPERIENCE means decayed, missing or filled — a treated tooth still
 *  counts. Caries ACTIVE means currently decayed. They are different questions
 *  and the form asks both. */
const yesNo = (b: boolean) => (b ? '1' : '0');

// The first four come from `shared/cariesStatus.ts` (2026-10-01), the ONE
// definition the Risk Classification screen also uses, so the two can never
// disagree about the same child. This form still prints them as 1/0.
const STATUS_COLUMNS: ServiceCol[] = [
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience', value: (r) => yesNo(cariesStatus(r.conditions).withCariesExperience) },
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience in Temporary Teeth', value: (r) => yesNo(cariesStatus(r.conditions).inTemporaryTeeth) },
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience in Permanent Dentition', value: (r) => yesNo(cariesStatus(r.conditions).inPermanentDentition) },
  { group: 'ORAL HEALTH STATUS', label: 'With Active Dental Caries', value: (r) => yesNo(cariesStatus(r.conditions).withActiveCaries) },
  { group: 'ORAL HEALTH STATUS', label: 'Gingivitis / Periodontal Disease', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.gum)) },
  { group: 'ORAL HEALTH STATUS', label: 'Oral Debris', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.debris)) },
  { group: 'ORAL HEALTH STATUS', label: 'Calcular Deposits', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.calculus)) },
  { group: 'ORAL HEALTH STATUS', label: 'Dento-Facial Anomaly', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.anomaly)) },
  // On the form; impossible for a school roll and recorded nowhere.
  { group: 'ORAL HEALTH STATUS', label: 'Completely Edentulous / No Dentition' },
  { group: 'ORAL HEALTH STATUS', label: 'd', value: (r) => String(r.conditions['d'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'f', value: (r) => String(r.conditions['f'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'x', value: (r) => String(r.conditions['x'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Sound Temporary Tooth', value: (r) => String(r.conditions[SOUND_TEMPORARY] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'D', value: (r) => String(r.conditions['D'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'M', value: (r) => String(r.conditions['M'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'F', value: (r) => String(r.conditions['F'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'X', value: (r) => String(r.conditions['X'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Sound Permanent Teeth', value: (r) => String(r.conditions[SOUND_PERMANENT] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Caries Free', value: (r) => yesNo(!cariesStatus(r.conditions).withCariesExperience) },
];

const SERVICE_COLUMNS: ServiceCol[] = [
  ...STATUS_COLUMNS,
  ...PREVENTIVE_SET((r) => r.visit1Done, false).map((c) => ({ ...c, group: 'FIRST' as const })),
  ...PREVENTIVE_SET((r) => r.visit2Done, true).map((c) => ({ ...c, group: 'SECOND' as const })),
  // ⚠ ALL of these are TOOTH COUNTS on the form (workbook AX-BD), not ticks.
  // The app rendered ✓ for the first four, and Sprint 82 additionally created a
  // DUPLICATE Temporary Filling column by adding the tooth-count variant beside
  // the tick one. Both errors corrected here against the workbook.
  { group: 'OTHER SERVICES', label: 'Composite Filling (Tooth Count)', value: (r) => String(r.toothCounts['PF'] ?? '') },
  { group: 'OTHER SERVICES', label: 'ART (Tooth Count)', value: (r) => String(r.toothCounts['TR'] ?? '') },
  { group: 'OTHER SERVICES', label: 'Temporary Filling (Tooth Count)', value: (r) => String(r.toothCounts['TF'] ?? '') },
  { group: 'OTHER SERVICES', label: 'Extraction (Tooth Count)', value: (r) => String(r.toothCounts['X'] ?? '') },
  // ONE column, here — between Extraction and the sealant — per the filed
  // sample. The workbook transcription had two ("Scaling" / "Prescription")
  // and put them after the SDF pair.
  { group: 'OTHER SERVICES', label: 'Gum Treatment' },
  // 'Removal of Plaque / Calculus' REMOVED 2026-09-03 — confirmed absent from
  // the workbook, like 'Complete Health Record' before it. Both were read off
  // the illegible Appendix E scan.
  { group: 'OTHER SERVICES', label: 'Pit and Fissure Sealant (Tooth Count)', value: (r) => String(r.toothCounts['PFS'] ?? '') },
  // The form has a 1st AND a 2nd SDF column, both tooth counts. The app had a
  // tick for the 1st and a blank for the 2nd.
  { group: 'OTHER SERVICES', label: '1st Silver Diamine Fluoride App (tooth count)', value: (r) => String(r.toothCounts['SDF'] ?? '') },
  { group: 'OTHER SERVICES', label: '2nd Silver Diamine Fluoride App (tooth count)' },
  { group: 'OTHER SERVICES', label: 'Consultation' },
  { group: 'OTHER SERVICES', label: 'Referred Out' },
  { group: 'OTHER SERVICES', label: 'Complete Mouth Rehab' },

  // ⚠ ONE column, the LAST on page 1, and DELIBERATELY BLANK.
  //
  // It used to print a ✓ from `r.orallyFit`, which is `oralStatus === 'Orally
  // Fit'`, which is `risk === "Low"` and nothing else. "Orally Fit Child" is a
  // DOH indicator with a clinical definition — caries-free or treated, no
  // debris, no gum pathology — that needs a judgement this system does not
  // store. A risk band is not that judgement, and this sheet is filed with the
  // City Health Office. Same reason the IPTR row for it is blank and the
  // barangay dashboard says "Low caries risk" instead (4bd5deb0).
  //
  // The workbook transcription had a PAIR here (Upon Oral Examination / After
  // Complete Mouth Rehabilitation); the filed sample has one.
  { group: 'ORALLY FIT CHILD', label: 'Orally Fit Child' },
];

const SERVICE_GROUPS = SERVICE_COLUMNS.reduce<{ label: string; span: number }[]>((acc, c) => {
  const last = acc[acc.length - 1];
  if (last && last.label === c.group) last.span += 1;
  else acc.push({ label: c.group, span: 1 });
  return acc;
}, []);

const TCL_UNVERIFIED = SERVICE_COLUMNS.filter((c) => c.unverified).length;
// TCL_COLSPAN removed 2026-09-03: it hardcoded "10 identity columns", was read
// by nothing (the JSX computes its own colSpan from the VISIBLE columns, which
// is what a hideable table needs), and Sprint 82 took identity to 13 — a dead
// constant that was now also wrong.

/** 8.5 x 13in long bond, landscape, 6mm margins: the sheet and margin the print rules use. */
const LONG_BOND_LANDSCAPE = { widthMm: 330.2, heightMm: 215.9, marginMm: 6 };

export const TargetClientList = () => {
  // → The filed sample is a wide landscape sheet: 30 columns on page 1, 31 on page 2.
  usePrintOrientation('landscape');
  const { selectedSchool } = useAuth();
  const { students, loading: studentsLoading } = useStudents();
  const { records: rpcRecords, loading: rpcLoading } = useRPCTracking();
  // The list hooks drop address / contact / PhilHealth, which the TCL needs, so
  // the raw records are fetched alongside them for those three fields only.
  const [raw, setRaw] = useState<ApiStudent[]>([]);
  const [rawError, setRawError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('monthly');
  const [anchor, setAnchor] = useState(() => toLocalDateString(new Date()));
  const [rangeStart, setRangeStart] = useState(() => toLocalDateString(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => toLocalDateString(new Date()));

  const { preview, building, previewPdf, closePreview, confirmDownload } = usePreviewModal();
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [orals, setOrals] = useState<ApiOralHealthCondition[]>([]);
  const [iptrs, setIptrs] = useState<ApiStudentIptr[]>([]);

  useEffect(() => {
    apiClient.get<ApiStudent[]>('/students')
      .then(setRaw)
      .catch(() => setRawError('Could not load address and PhilHealth details.'));
    // ORAL_HEALTH_CONDITION backs the form's Gum/Perio, Debris, Calcular and
    // Dento-Facial Anomaly columns. Joined through STUDENT_IPTR, which is why
    // both are fetched.
    Promise.all([
      apiClient.get<ApiOralHealthCondition[]>('/oral-health-conditions'),
      apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
    ])
      .then(([o, i]) => { setOrals(o); setIptrs(i); })
      .catch(() => { setOrals([]); setIptrs([]); });
  }, []);

  const rows = useMemo(() => {
    const rawById = new Map(raw.map((s) => [s._id, s]));
    const rpcById = new Map(rpcRecords.map((r) => [r.id, r]));
    // Past / future appointment dates per student, for Last and Next Dental
    // Visit. Split on "now" rather than on status so a completed-but-future or
    // an unstatused past booking still lands on the correct side.
    // Oral findings per STUDENT, resolved through the IPTR. When a student has
    // several years, the LATEST recorded examination wins — the form reports a
    // current status, not a historical one.
    const iptrToStudent = new Map(iptrs.map((i) => [i._id, i.student_id]));
    const iptrYear = new Map(iptrs.map((i) => [i._id, i.school_year ?? '']));
    const oralByStudent = new Map<string, { gum: boolean; debris: boolean; calculus: boolean; anomaly: boolean }>();
    const oralYear = new Map<string, string>();
    for (const o of orals) {
      const sid = iptrToStudent.get(o.iptr_id);
      if (!sid) continue;
      const year = iptrYear.get(o.iptr_id) ?? '';
      if (oralByStudent.has(sid) && (oralYear.get(sid) ?? '') >= year) continue;
      oralYear.set(sid, year);
      oralByStudent.set(sid, {
        gum: o.gingivitis === true || o.periodontal_disease === true,
        debris: o.debris === true,
        calculus: o.calculus === true,
        anomaly: o.abnormal_growth === true,
      });
    }

    return students
      .filter((s) => !s.pending && (!selectedSchool || s.school === selectedSchool))
      .map((s) => {
        const r = rpcById.get(s.id);
        const detail = rawById.get(s.id);
        const age = ageFrom(s.birthdate, r?.visit1Date ?? null);
        return {
          id: s.id,
          name: s.name,
          philhealth: detail?.philhealth_number || '',
          address: detail?.address || '',
          contact: detail?.contact_number || '',
          birthdate: s.birthdate,
          age,
          ageGroup: ageGroupOf(age),
          sex: s.gender?.[0]?.toUpperCase() ?? '',
          consultDate: r?.visit1Date ?? null,
          risk: s.riskLevel,
          visit1Done: r?.visit1Status === 'Completed',
          visit2Done: r?.visit2Status === 'Completed',
          visit1Services: r?.visit1Services ?? null,
          visit2Services: r?.visit2Services ?? null,
          treatments: r?.treatmentCodes ?? [],
          toothCounts: r?.treatmentToothCounts ?? {},
          conditions: r?.conditionToothCounts ?? {},
          oral: oralByStudent.get(s.id) ?? null,
        };
      });
  }, [students, rpcRecords, raw, orals, iptrs, selectedSchool]);

  // Sprint 130 — the same fault Sprint 128 fixed on the school-year filter,
  // in the control that fix did not reach. This anchor defaults to TODAY, so
  // opening the Target Client List in September 2026 asked for a month in which
  // nothing had happened: the form rendered all 66 columns and NOT ONE ROW, on
  // a database holding 23 recorded consultations (2026-02-16 to 2026-08-29).
  // An empty period is indistinguishable from a broken report.
  //
  // Once the rows are known, an anchor whose period contains no consultation is
  // moved to the LATEST consultation date — the period a clinic actually wants
  // when it opens the list. Done once, so it never fights the date picker, and
  // never when the user has already moved it themselves.
  const latestConsult = useMemo(() => {
    const dates = rows.map((r) => r.consultDate).filter((d): d is string => !!d).sort();
    return dates.length ? dates[dates.length - 1].slice(0, 10) : null;
  }, [rows]);

  const didAlignAnchor = useRef(false);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const { edge, step } = useGridScroll(paneRef, 'thead th', [studentsLoading, rpcLoading]);
  // The pane fills the screen below the status strip, so once the page is scrolled to the table the
  // label row and No. column stay put and only the cells scroll.
  const paneOffset = TOPBAR_H + 18;
  useEffect(() => {
    if (didAlignAnchor.current || !latestConsult) return;
    const { start: s0, end: e0 } = periodRange(anchor, period, rangeStart, rangeEnd);
    const [ly, lm, ld] = latestConsult.split('-').map(Number);
    const anyInPeriod = rows.some((r) => {
      if (!r.consultDate) return false;
      const [y, m, d] = r.consultDate.slice(0, 10).split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt >= s0 && dt < e0;
    });
    if (!anyInPeriod) setAnchor(toLocalDateString(new Date(ly, lm - 1, ld)));
    didAlignAnchor.current = true;
  }, [rows, latestConsult, anchor, period, rangeStart, rangeEnd]);

  const [anchorYear, anchorMonth] = anchor.split('-').map(Number);
  const { start, end, label: periodLabel } = useMemo(() => periodRange(anchor, period, rangeStart, rangeEnd), [anchor, period, rangeStart, rangeEnd]);

  // Filtered on DATE OF CONSULTATION, which is the form's own first column —
  // a client with no recorded consultation has nothing to report for any
  // period, so they fall out rather than padding every range with blank rows.
  const visible = useMemo(() => rows.filter((r) => {
    if (!r.consultDate) return false;
    const [y, m, d] = r.consultDate.slice(0, 10).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt >= start && dt < end;
  }), [rows, start, end]);

  const withoutConsult = rows.length - rows.filter((r) => r.consultDate).length;

  // Hidden columns, remembered per browser. Hiding CHANGES WHAT PRINTS, which
  // is what the dentist asked for; the note above the table declares it so a
  // shortened sheet is never mistaken for the complete DOH form (Sprint 71).
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem('tcl-hidden-cols');
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const [showPicker, setShowPicker] = useState(false);
  const hideToggle = (key: string) => setHiddenCols((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { window.localStorage.setItem('tcl-hidden-cols', JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });
  const showAllCols = () => {
    setHiddenCols(new Set());
    try { window.localStorage.setItem('tcl-hidden-cols', '[]'); } catch { /* private mode */ }
  };

  // ── Official output ───────────────────────────────────────────────────────
  // ⚠ THIS TABLE IS A NAMED LIST OF MINORS and it is exported anyway. That is a
  // deliberate, narrow exception to Sprint 52's rule ("official aggregate
  // output may leave the system; raw patient lists may not"), on the user's
  // decision 2026-09-03: **the City Health Office requires the Excel format** —
  // the DOH source itself ships as TCLForm2andFHSISReport.xlsx. This is the
  // filed statutory return, not a convenience dump, which is exactly the
  // distinction Sprint 52 drew when it removed the Students/RPC/Appointments
  // exports. Do NOT generalise it into a "download the roster" feature.
  // Filename carries the period and school, so a filed return is identifiable
  // from the file alone rather than from where it happened to be saved.
  const exportBaseName = `TCL_${(selectedSchool ?? 'All Schools').replace(/[^\w]+/g, '-')}_${periodLabel.replace(/[^\w]+/g, '-')}`;

  // Writes the SAME cells the screen shows, "—" included, so the workbook makes
  // the identical claims as the report. Writing 0 where the screen says "—"
  // would turn "not recorded" into "none" the moment it left the app.
  // ── The workbook is TWO SHEETS, because the form is TWO PAGES (Sprint 134) ──
  //
  // Read from the manuscript's own scans (Appendix E: `image16` = page 1,
  // `image17` = page 2), not inferred:
  //
  //   PAGE 1  No. · Date of Consult · Facility Based · Family Serial Number ·
  //           Barangay · PhilHealth No. · Name · Address · Contact · Date of
  //           Birth · Age · Age Group · Sex, then the whole ORAL HEALTH STATUS
  //           block, ending at "Caries Free" and "Orally Fit Child".
  //   PAGE 2  a REPEATED `No.` column, then FIRST visit, SECOND visit and
  //           OTHER SERVICES, ending in REMARKS (Specify other findings).
  //
  // The app renders both pages' columns as one continuous table on SCREEN,
  // which is right for a screen — a 66-column sheet cannot be read any other
  // way. The filed artifact is the workbook (TCL is Excel-only, decided
  // 2026-09-03), so that is where the form's own pagination has to be
  // reproduced: "a printout IS the form", and a two-page form filed as one
  // 66-column sheet is a different document.
  //
  // ⚠ `No.` is repeated on sheet 2 ON PURPOSE. It is the form's own row link
  // between the pages; without it sheet 2 is an unjoinable block of ticks.
  //
  // ⚠ ONE PLACEMENT IS UNVERIFIED: the scans are 540x375, and while ORAL
  // HEALTH STATUS clearly ends page 1 and OTHER SERVICES clearly ends page 2,
  // the DENTAL VISIT pair (Last / Next Dental Visit) could not be resolved on
  // either scan. It is placed on page 2 with the services, which is where a
  // visit date belongs — but if a sharper scan says otherwise, this is the
  // line to change, and it is the only one.
  const PAGE1_GROUPS = ['ORAL HEALTH STATUS', 'ORALLY FIT CHILD'];

  // ⚠ THE FORM IS 25 RULED ROWS, and they are part of the form.
  //
  // Counted on the filed sample the user supplied: both pages are numbered 1
  // to 25, and that sheet was submitted with 21 filled and rows 22-25 blank.
  // This table used to stop after the last client — four rows on a 25-row
  // form — which is the same class of error as a missing column: "a blank cell
  // on a DOH form is meaningful; a MISSING one is a different form" (CLAUDE.md).
  //
  // Over 25 clients the paper form runs to a second sheet, so the count rounds
  // UP to whole sheets rather than stopping mid-block.
  const FORM_ROWS = 25;
  const ruledRows = Math.max(FORM_ROWS, Math.ceil(visible.length / FORM_ROWS) * FORM_ROWS);
  const blankRowIndexes = Array.from({ length: ruledRows - visible.length }, (_, n) => visible.length + n);

  const onPdf = () => {
    const els = Array.from(sheetsRef.current?.querySelectorAll<HTMLElement>('.tcl-sheet') ?? []);
    previewPdf('Target Client List', `${exportBaseName}.pdf`, () => buildPagesPdf(els, LONG_BOND_LANDSCAPE));
  };

  // Excel downloads straight away (user-approved Print menu, 2026-10-08); the
  // PDF is the one that opens a preview first.
  const onXlsx = async () => {
    setXlsxBusy(true);
    try {
      const blob = await (async () => {
      // `row: null` is one of the form's blank ruled rows — numbered, empty.
      type XlsxRow = { row: Row | null; i: number };
      const svc = (c: (typeof visibleServices)[number]) => ({
        label: `${c.group} — ${c.label}`,
        value: (r: XlsxRow) => (r.row ? String(c.value ? c.value(r.row) : NO_SOURCE) : ''),
      });
      const numberCol = {
        label: 'No.',
        value: (r: XlsxRow) => String(r.i + 1),
      };

      const page1 = [
        ...visibleIdentity.map((c) => ({
          label: c.label,
          value: (r: XlsxRow) => (r.row ? String(c.value(r.row, r.i) ?? '') : c.key === 'no' ? String(r.i + 1) : ''),
        })),
        ...visibleServices.filter((c) => PAGE1_GROUPS.includes(c.group)).map(svc),
      ];

      const page2 = [
        numberCol,
        ...visibleServices.filter((c) => !PAGE1_GROUPS.includes(c.group)).map(svc),
        ...(remarksVisible ? [{ label: 'REMARKS (Specify other findings)', value: () => '' }] : []),
      ];

      // The workbook is the artifact that gets filed, so it carries the form's
      // blank ruled rows too — same count as the screen.
      const rows: XlsxRow[] = [
        ...visible.map((row, i) => ({ row: row as Row | null, i })),
        ...blankRowIndexes.map((i) => ({ row: null, i })),
      ];
      return buildSheetsXlsx([
        { name: 'Page 1', rows, columns: page1 },
        { name: 'Page 2', rows, columns: page2 },
      ]);
      })();
      downloadBlob(blob, `${exportBaseName}.xlsx`);
    } finally {
      setXlsxBusy(false);
    }
  };

  if (studentsLoading || rpcLoading) return <SkeletonTable rows={8} />;

  const IDENTITY_COLUMNS: IdentityCol[] = [
    { key: 'no', label: 'No.', value: (_r, i) => i + 1 },
    { key: 'consult', label: 'Date of consultation', head: <>Date of<br />consultation</>, value: (r) => (r.consultDate ? formatDate(r.consultDate) : '') },
    // ⚠ Facility Based, Family Serial Number and Barangay USED TO SIT HERE.
    //   They came from the workbook transcription (Sprint 82/84,
    //   TCLForm2andFHSISReport.xlsx). The FILED SAMPLE the user supplied
    //   2026-09-06 — Bagong Tanyag, Grade 1, dated 8-5-25, the sheet this
    //   barangay actually submits — has none of the three: it runs No. → Date
    //   of Consult → PhilHealth No. → Name → Address → Contact → Date of
    //   Birth → Age → Age Group → Sex and straight into ORAL HEALTH STATUS.
    //   The two sources are different editions of the form; the filed one wins,
    //   because it is the document that leaves the building. Restoring them is
    //   one revert of this commit if the workbook edition turns out to govern.
    { key: 'philhealth', label: 'PhilHealth No.', value: (r) => r.philhealth },
    { key: 'name', label: 'Name', head: <>Name<br /><span className="font-normal">(Last, First, MI)</span></>, value: (r) => r.name, cls: 'font-medium' },
    { key: 'address', label: 'Complete Address', value: (r) => r.address, cls: 'max-w-[220px] truncate' },
    { key: 'contact', label: 'Contact Number', value: (r) => r.contact },
    { key: 'dob', label: 'Date of Birth', value: (r) => (r.birthdate ? formatDate(r.birthdate) : '') },
    { key: 'age', label: 'Age', rotate: true, value: (r) => r.age ?? '' },
    { key: 'agegroup', label: 'Age Group', rotate: true, value: (r) => r.ageGroup },
    { key: 'sex', label: 'Sex', value: (r) => r.sex },
  ];
  const visibleIdentity = IDENTITY_COLUMNS.filter((c) => !hiddenCols.has(`id|${c.key}`));
  const visibleServices = SERVICE_COLUMNS.filter((c) => !hiddenCols.has(`sv|${c.group}|${c.label}`));
  const remarksVisible = !hiddenCols.has('id|remarks');
  // Group bands must span only what is shown, or the header drifts out of
  // alignment with its body.
  const visibleServiceGroups = visibleServices.reduce<{ label: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last && last.label === c.group) last.span += 1;
    else acc.push({ label: c.group, span: 1 });
    return acc;
  }, []);
  const hiddenCount = hiddenCols.size;

  // The form's own page split. `visibleServiceGroups` is still computed above
  // for nothing else now, so it is derived per page instead.
  const page1Services = visibleServices.filter((c) => PAGE1_GROUPS.includes(c.group));
  const page2Services = visibleServices.filter((c) => !PAGE1_GROUPS.includes(c.group));
  /** Page 2 opens with a repeated `No.`, exactly as the paper form does — it is
   *  the only thing joining a row of ticks back to the student named on page 1.
   *  Not subject to the column picker for that reason. */
  const NUMBER_COLUMN: IdentityCol = { key: 'no', label: 'No.', value: (_r, i) => i + 1 };

  /** The paper form groups the three caries-risk answers under ONE
   *  "Caries Risk assessment" caption (Low / Moderate / High). The column list
   *  keeps flat labels ("Caries Risk assessment - Low"), so this splits them
   *  back into the form's two-line header. `cell` draws one leaf caption. */
  const RISK_PFX = 'Caries Risk assessment - ';
  const leafLayout = (
    cols: ServiceCol[],
    cell: (c: ServiceCol, label: string, key: string, rowSpan: number) => ReactNode,
    bandCell: (span: number, key: string) => ReactNode,
  ) => {
    const hasRisk = cols.some((c) => c.label.startsWith(RISK_PFX));
    const top: ReactNode[] = [];
    const bottom: ReactNode[] = [];
    for (let i = 0; i < cols.length;) {
      const c = cols[i];
      if (c.label.startsWith(RISK_PFX)) {
        let j = i;
        while (j < cols.length && cols[j].label.startsWith(RISK_PFX)) j += 1;
        top.push(bandCell(j - i, `risk-${i}`));
        for (let k = i; k < j; k += 1) bottom.push(cell(cols[k], cols[k].label.slice(RISK_PFX.length), `${cols[k].group}-${k}`, 1));
        i = j;
      } else {
        top.push(cell(c, c.label, `${c.group}-${i}`, hasRisk ? 2 : 1));
        i += 1;
      }
    }
    return { top, bottom, hasRisk };
  };

  // ── THE PRINTED / PDF FORM: an exact copy of the paper sheets ─────────────
  // (user, 2026-10-06: "exact copy ... the same physical copy when printed").
  // Plain white, black ruled grid, the form's centred title, rotated captions on
  // the narrow columns, 25 numbered rows a sheet, page 1 = identity + ORAL
  // HEALTH STATUS, page 2 = repeated No. + ROUTINE PREVENTIVE CARE (FIRST /
  // SECOND) + OTHER SERVICES + REMARKS. Styles live in index.css (`.tcl-sheet`)
  // at a FIXED 1200 x 760px so the print, the PDF preview and the PDF are the
  // same picture. The sheets sit off-screen until printed or captured.
  const SHEET_TITLE = 'Target Client List for Oral Health Care and Services';
  // Column weights (px at the 1200px sheet), read off the paper form's photo.
  const WIDE_W: Record<string, number> = { no: 30, consult: 66, philhealth: 64, name: 138, address: 118, contact: 60, dob: 60, age: 22, agegroup: 44, sex: 22 };
  const sheetCols = (identity: IdentityCol[], services: ServiceCol[], narrow: number, remarks: boolean) => {
    const w = [...identity.map((c) => WIDE_W[c.key] ?? 60), ...services.map(() => narrow), ...(remarks ? [150] : [])];
    const total = w.reduce((a, b) => a + b, 0);
    return <colgroup>{w.map((x, i) => <col key={i} style={{ width: `${(x / total) * 100}%` }} />)}</colgroup>;
  };
  const rotCell = (label: string, key: string, rowSpan?: number) => (
    <th key={key} rowSpan={rowSpan} className="rot"><div>{label}</div></th>
  );
  const bandCell = (label: string, span: number, rowSpan?: number, sub?: string) => (
    <th key={label} colSpan={span} rowSpan={rowSpan}>{label}{sub && <div className="sub">{sub}</div>}</th>
  );
  const dataCell = (r: Row | null, c: ServiceCol, k: string) => (
    <td key={k}>{r ? (c.value ? c.value(r) : NO_SOURCE) : ''}</td>
  );
  const sheetPage1 = (rows: { r: Row | null; n: number }[], key: string) => {
    const ohsCols = page1Services.filter((c) => c.group === 'ORAL HEALTH STATUS');
    const ofcCols = page1Services.filter((c) => c.group === 'ORALLY FIT CHILD');
    return (
      <section key={key} className="tcl-sheet">
        <h3>{SHEET_TITLE}</h3>
        <table>
          {sheetCols(visibleIdentity, page1Services, 28.8, false)}
          <thead>
            <tr style={{ height: 16 }}>
              {visibleIdentity.map((c) => (c.rotate
                ? rotCell(c.label, c.key, 2)
                : <th key={c.key} rowSpan={2}>{c.head ?? c.label}</th>))}
              {ohsCols.length + ofcCols.length > 0 && bandCell('ORAL HEALTH STATUS', ohsCols.length + ofcCols.length)}
            </tr>
            <tr style={{ height: 174 }}>{[...ohsCols, ...ofcCols].map((c, i) => rotCell(c.label, `ohs-${i}`))}</tr>
          </thead>
          <tbody>
            {rows.map(({ r, n }) => (
              <tr key={n}>
                {visibleIdentity.map((c) => (
                  <td key={c.key} className={c.key === 'name' || c.key === 'address' ? 'l' : undefined}>
                    {c.key === 'no' ? n + 1 : r ? c.value(r, n) : ''}
                  </td>
                ))}
                {[...ohsCols, ...ofcCols].map((c, k) => dataCell(r, c, `${c.label}-${k}`))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };
  const sheetPage2 = (rows: { r: Row | null; n: number }[], key: string) => {
    const first = page2Services.filter((c) => c.group === 'FIRST');
    const second = page2Services.filter((c) => c.group === 'SECOND');
    const other = page2Services.filter((c) => c.group === 'OTHER SERVICES');
    const body = [...first, ...second, ...other];
    const L = leafLayout(
      body,
      (c, label, k, rs) => rotCell(label, k, rs),
      (span, k) => <th key={k} colSpan={span}>Caries Risk assessment</th>,
    );
    const head = L.hasRisk ? 4 : 3;
    return (
      <section key={key} className="tcl-sheet">
        <h3>{SHEET_TITLE}</h3>
        <table>
          {sheetCols([NUMBER_COLUMN], body, 35, remarksVisible)}
          <thead>
            <tr style={{ height: 16 }}>
              <th rowSpan={head}>No.</th>
              {first.length + second.length > 0 && bandCell('ROUTINE PREVENTIVE CARE', first.length + second.length)}
              {other.length > 0 && bandCell('OTHER SERVICES', other.length, 2)}
              {remarksVisible && <th rowSpan={head}>REMARKS (Specify other findings)</th>}
            </tr>
            <tr style={{ height: 26 }}>
              {first.length > 0 && bandCell('FIRST', first.length)}
              {second.length > 0 && bandCell('SECOND', second.length, undefined, 'at least 4 months interval from the first visit')}
            </tr>
            <tr style={{ height: L.hasRisk ? 16 : 148 }}>{L.top}</tr>
            {L.hasRisk && <tr style={{ height: 132 }}>{L.bottom}</tr>}
          </thead>
          <tbody>
            {rows.map(({ r, n }) => (
              <tr key={n}>
                <td>{n + 1}</td>
                {body.map((c, k) => dataCell(r, c, `${c.group}-${c.label}-${k}`))}
                {remarksVisible && <td />}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };
  /** The form runs to whole sheets of 25 rows; each sheet is page 1 then page 2. */
  const sheetRows: { r: Row | null; n: number }[] = [
    ...visible.map((r, n) => ({ r: r as Row | null, n })),
    ...blankRowIndexes.map((n) => ({ r: null as Row | null, n })),
  ];
  const sheetChunks = Array.from({ length: Math.ceil(sheetRows.length / FORM_ROWS) }, (_, i) => sheetRows.slice(i * FORM_ROWS, (i + 1) * FORM_ROWS));

  const tick = (on: boolean) => (on ? '✓' : '');
  const hasCode = (codes: string[], code: string) => (codes.includes(code) ? '✓' : '');

  const td = 'px-2 py-1.5 text-xs text-foreground border border-border whitespace-nowrap';

  // ── ON SCREEN: the whole form as ONE continuous table (user, 2026-10-06) ──
  // The paper form is two sheets and still PRINTS as two (the `formPage`
  // tables below, shown only in print), but a screen reads it better as one
  // grid, in the OCR bulk-scan grid's colors. Same column order as the two
  // pages laid side by side: identity + ORAL HEALTH STATUS + ORALLY FIT CHILD,
  // then ROUTINE PREVENTIVE CARE (FIRST / SECOND), OTHER SERVICES, REMARKS.
  // Only the label rows and the No. column are pinned; everything else scrolls.
  const NAVY = '#E3ECFB'; // header fill: light blue (user, 2026-10-06), dark-blue text
  const sOf = (g: ServiceCol['group']) => visibleServices.filter((c) => c.group === g);
  const ohs = sOf('ORAL HEALTH STATUS');
  const ofc = sOf('ORALLY FIT CHILD');
  const first = sOf('FIRST');
  const second = sOf('SECOND');
  const other = sOf('OTHER SERVICES');
  const rpcN = first.length + second.length;
  const hCell = 'border border-t-0 border-l-0 border-[#A9BDE6] px-2 py-0.5 text-[11px] font-bold text-[#273A78] text-center leading-tight';
  // Captions read LEFT-TO-RIGHT on screen (user, 2026-10-06); only the printed form rotates them.
  const hLeaf = `${hCell} align-middle whitespace-normal leading-tight`;
  // Lighter blue than the bands, and wide enough that a caption wraps to TWO lines at most
  // (user, 2026-10-06), so the label row stays thin.
  const LEAF_BG = '#E3ECFB';
  const leafStyle = (label: string): CSSProperties => {
    const w = `clamp(6rem, ${(label.length * 0.27 + 1.6).toFixed(2)}rem, 13.5rem)`;
    return { background: LEAF_BG, width: w, minWidth: w, maxWidth: w };
  };
  const sLayout = leafLayout(
    [...ohs, ...ofc, ...first, ...second, ...other],
    (_c, label, key, rs) => <th key={key} rowSpan={rs} className={hLeaf} style={leafStyle(label)}>{label}</th>,
    (span, key) => <th key={key} colSpan={span} className={hCell} style={{ background: '#D2E0F7' }}>Caries Risk assessment</th>,
  );
  const headRows = sLayout.hasRisk ? 4 : 3;
  const idWidth: Record<string, string> = { consult: 'min-w-28', philhealth: 'min-w-28', name: 'min-w-48', address: 'min-w-56', contact: 'min-w-28', dob: 'min-w-24' };
  const sTd = `border border-t-0 border-l-0 border-[#CBD5E1] px-2 py-1.5 text-xs text-foreground whitespace-nowrap`;
  const screenTable = (
    <div className="relative w-full min-w-0 max-w-full rounded-t-xl border border-[#A9BDE6] bg-card overflow-hidden">
      <div ref={paneRef} className="no-scrollbar cursor-grab w-full overflow-auto rounded-t-xl" style={{ maxHeight: `max(320px, calc(100vh - ${paneOffset}px))` }}>
        <table className="border-separate border-spacing-0 w-max min-w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              {visibleIdentity.map((c) => (
                <th key={c.key} rowSpan={headRows} style={{ background: NAVY }}
                    className={`${hCell} align-middle ${idWidth[c.key] ?? 'min-w-14'} ${c.key === 'no' ? 'sticky left-0 z-30 min-w-16' : ''}`}>
                  {c.head ?? c.label}
                </th>
              ))}
              {ohs.length + ofc.length > 0 && <th colSpan={ohs.length + ofc.length} rowSpan={2} className={hCell} style={{ background: '#BCCFF0' }}>ORAL HEALTH STATUS</th>}
              {rpcN > 0 && <th colSpan={rpcN} className={hCell} style={{ background: '#BCCFF0' }}>ROUTINE PREVENTIVE CARE</th>}
              {other.length > 0 && <th colSpan={other.length} rowSpan={2} className={hCell} style={{ background: '#BCCFF0' }}>OTHER SERVICES</th>}
              {remarksVisible && (
                <th rowSpan={headRows} className={`${hCell} align-middle min-w-48`} style={{ background: NAVY }}>Remarks</th>
              )}
            </tr>
            <tr>
              {first.length > 0 && <th colSpan={first.length} className={hCell} style={{ background: '#D2E0F7' }}>FIRST</th>}
              {second.length > 0 && (
                <th colSpan={second.length} className={hCell} style={{ background: '#D2E0F7' }}>
                  SECOND
                  <div className="font-normal text-[10px]">at least 4 months interval from the first visit</div>
                </th>
              )}
            </tr>
            <tr>{sLayout.top}</tr>
            {sLayout.hasRisk && <tr>{sLayout.bottom}</tr>}
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.id} className="even:bg-[#F5F8FF] hover:bg-[#E8EEFB]">
                {visibleIdentity.map((c) => c.key === 'no'
                  ? <td key={c.key} className={`${sTd} sticky left-0 z-10 bg-[#E8EEFB] text-center text-muted-foreground`}>{i + 1}</td>
                  : <td key={c.key} className={`${sTd} ${c.cls ?? ''}`} title={c.key === 'address' ? r.address : undefined}>{c.value(r, i)}</td>)}
                {[...ohs, ...ofc, ...first, ...second, ...other].map((c, n) => (
                  <td key={`${c.group}-${c.label}-${n}`} className={`${sTd} text-center ${c.value ? '' : 'text-muted-foreground'}`}>
                    {c.value ? c.value(r) : NO_SOURCE}
                  </td>
                ))}
                {remarksVisible && <td className={sTd} />}
              </tr>
            ))}
            {/* The form's remaining ruled rows: numbered, otherwise empty. */}
            {blankRowIndexes.map((n) => (
              <tr key={`blank-${n}`} className="even:bg-[#F5F8FF]">
                {visibleIdentity.map((c) => c.key === 'no'
                  ? <td key={c.key} className={`${sTd} sticky left-0 z-10 bg-[#E8EEFB] text-center text-muted-foreground`}>{n + 1}</td>
                  : <td key={c.key} className={sTd} />)}
                {[...ohs, ...ofc, ...first, ...second, ...other].map((c, k) => <td key={`b-${c.group}-${c.label}-${k}`} className={sTd} />)}
                {remarksVisible && <td className={sTd} />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GridEdgeButtons edge={edge} onStep={step} leftInFirstColumn />
    </div>
  );

  return (
    <div className="min-w-0 max-w-full space-y-8">
      {/* Controls: see ReportControls.tsx. Excel is listed first — the City
          Health Office requires it (decided 2026-09-03). The TCL is 66 columns;
          Excel paginates columns natively. PDF (added 2026-10-06) is the exact
          two-page form. Range, month, quarter, half and year all filter by the
          consultation date. */}
      <PanelShell>
        <PanelRow>
          <GroupBox title="Time period" icon={Clock} className={BOX_W}>
            <PeriodSwitch<Period> name="Time period" value={period} onChange={setPeriod}
              options={[{ v: 'range', kind: 'range' }, { v: 'monthly', kind: 'month' }, { v: 'quarterly', kind: 'quarter' }, { v: 'half', kind: 'half' }, { v: 'annual', kind: 'year' }]} />
          </GroupBox>
          <GroupBox title="Dates" icon={CalendarDays} className="w-full lg:w-auto lg:px-6">
            {period === 'range' ? (
              <RangePicker start={rangeStart} end={rangeEnd} onChange={(a, b) => { setRangeStart(a); setRangeEnd(b); }} />
            ) : (
              <div className="flex w-full gap-5 lg:w-auto lg:gap-6">
                {period !== 'annual' && (
                  <Underlined label={period === 'monthly' ? 'Month' : period === 'quarterly' ? 'Quarter' : 'Half'} icon={Calendar} chevron>
                    <select aria-label="Period" className={`${fieldInputClass} !pr-5`}
                      value={period === 'monthly' ? anchorMonth : period === 'quarterly' ? Math.floor((anchorMonth - 1) / 3) + 1 : anchorMonth < 7 ? 1 : 2}
                      onChange={(e) => { const n = Number(e.target.value); setAnchor(`${anchorYear}-${String(period === 'monthly' ? n : period === 'quarterly' ? (n - 1) * 3 + 1 : (n - 1) * 6 + 1).padStart(2, '0')}-01`); }}>
                      {period === 'monthly' && MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                      {period === 'quarterly' && [1, 2, 3, 4].map((q) => <option key={q} value={q}>Quarter {q} ({MONTH_NAMES[(q - 1) * 3].slice(0, 3)} to {MONTH_NAMES[q * 3 - 1].slice(0, 3)})</option>)}
                      {period === 'half' && [1, 2].map((h) => <option key={h} value={h}>{h === 1 ? '1st half (Jan to Jun)' : '2nd half (Jul to Dec)'}</option>)}
                    </select>
                  </Underlined>
                )}
                <Underlined label="Year" icon={Calendar} chevron>
                  <select aria-label="Year" className={`${fieldInputClass} !pr-5`} value={anchorYear}
                    onChange={(e) => setAnchor(`${e.target.value}-${String(anchorMonth).padStart(2, '0')}-01`)}>
                    {Array.from(new Set([...[3, 2, 1, 0].map((i) => new Date().getFullYear() - i), anchorYear])).sort().map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Underlined>
              </div>
            )}
          </GroupBox>
          <ActionGroup>
            {/* Print / PDF (preview first) / Excel (downloads). Excel stays first in
                importance: the City Health Office requires it (decided 2026-09-03). */}
            <ExportMenu busy={xlsxBusy || (building && preview.kind === 'pdf')} onPrint={() => window.print()} onPdf={onPdf} onExcel={() => { void onXlsx(); }} excelDisabledReason={visible.length === 0 ? 'No clients' : undefined} />
          </ActionGroup>
        </PanelRow>
        <p className="sr-only" aria-live="polite">Showing {periodLabel}, {visible.length} client{visible.length !== 1 ? 's' : ''}</p>
      </PanelShell>
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">Target Client List for Oral Health Care and Services</h2>
        <p className="text-xs text-muted-foreground mt-2">
          <button
            onClick={() => setShowPicker((v) => !v)}
            aria-expanded={showPicker}
            className="float-right ml-3 text-xs px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50"
          >{showPicker ? 'Done' : `Columns${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}</button>
          <span className="font-semibold text-foreground">{periodLabel}</span> — showing {visible.length} client
          {visible.length !== 1 ? 's' : ''} consulted{selectedSchool ? ' at the selected school' : ' across all schools'}.
          {visible.length === 0 && latestConsult && (
            <span className="text-amber-700 font-medium">
              {' '}No consultation falls in this period; the most recent one on record is {formatDate(latestConsult)}.
            </span>
          )}
          {withoutConsult > 0 && ` ${withoutConsult} enrolled client${withoutConsult !== 1 ? 's have' : ' has'} no recorded consultation and appear${withoutConsult !== 1 ? '' : 's'} in no period.`}
        </p>
        {rawError && <p className="text-xs text-destructive mt-1">{rawError}</p>}
        <p className="text-xs text-muted-foreground mt-2">
          Every column of the paper form is shown, including those the system cannot fill — a blank cell on a
          DOH form is meaningful. Columns marked <span className="font-semibold">{NO_SOURCE}</span> have no
          source: preventive care records store the visit date only, not the individual services performed at
          it.
          {hiddenCount > 0 && (
            <> <span className="font-semibold text-foreground">This sheet is not the complete standard form:</span>{' '}
            {hiddenCount} column{hiddenCount === 1 ? '' : 's'} hidden, and hidden columns do not print.</>
          )}
          {TCL_UNVERIFIED > 0 && (
            <><span className="border-b border-dotted border-amber-500">Dotted</span> captions ({TCL_UNVERIFIED})
            were read from a low-resolution scan of Appendix E and still need checking against the paper form.</>
          )}
        </p>
      </div>

      {showPicker && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3 text-xs">
          <p className="text-muted-foreground">
            Untick to hide. Hiding changes what is <span className="font-medium text-foreground">printed</span>,
            not just what is on screen — anything hidden is declared above the table.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {IDENTITY_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!hiddenCols.has(`id|${c.key}`)}
                  onChange={() => hideToggle(`id|${c.key}`)} className="w-3.5 h-3.5 rounded accent-primary" />
                <span className="truncate" title={c.label}>{c.label}</span>
              </label>
            ))}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={remarksVisible}
                onChange={() => hideToggle('id|remarks')} className="w-3.5 h-3.5 rounded accent-primary" />
              <span>Remarks</span>
            </label>
            {SERVICE_COLUMNS.map((c, i) => (
              <label key={`${c.group}-${c.label}-${i}`} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!hiddenCols.has(`sv|${c.group}|${c.label}`)}
                  onChange={() => hideToggle(`sv|${c.group}|${c.label}`)} className="w-3.5 h-3.5 rounded accent-primary" />
                <span className="truncate" title={`${c.group} · ${c.label}`}>{c.label}</span>
              </label>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button onClick={showAllCols}
              className="px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50">
              Show everything
            </button>
          )}
        </div>
      )}

      {/* ⚠ TWO PAGES, NOT ONE LONG SHEET (user-reported 2026-09-06).
          The form IS two pages — Sprint 134 established the split and the Excel
          export has produced two sheets ever since, but the screen still ran all
          66 columns into a single 2,850px table. That put the columns in an
          order the form does not have: ORALLY FIT CHILD closes page 1 on paper
          and was rendering after OTHER SERVICES here, so anyone reading the
          screen was reading a different document from the one they file.

          Same split as the workbook export below, from one constant, so the two
          can never disagree: PAGE1_GROUPS ends page 1 at ORAL HEALTH STATUS +
          ORALLY FIT CHILD; everything else is page 2, which repeats `No.` as
          the form's own row link between the pages.

          Each page scrolls inside its own container — the form is wider than any
          screen and the page itself must never scroll sideways. */}
      {/* ON SCREEN: one table. IN PRINT AND IN THE PDF: the exact two-page
          form (`.tcl-sheets`, off-screen until printed or captured). */}
      {/* The negative bottom margin cancels the page padding, so at the end of the scroll the table touches
          the bottom edge of the screen (user, 2026-10-06). The Reports header scrolls away with the page. */}
      <div className="print-hide -mb-4 md:-mb-8">{screenTable}</div>
      <div ref={sheetsRef} className="form-print tcl-sheets" aria-hidden="true">
        {sheetChunks.flatMap((chunk, i) => [sheetPage1(chunk, `p1-${i}`), sheetPage2(chunk, `p2-${i}`)])}
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
