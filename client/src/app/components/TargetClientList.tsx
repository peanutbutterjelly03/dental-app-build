import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import type { ApiStudent, ApiAppointment, ApiOralHealthCondition, ApiStudentIptr } from '../api/types';
import { useStudents } from '../hooks/useStudents';
import { useRPCTracking, SOUND_TEMPORARY, SOUND_PERMANENT } from '../hooks/useRPCTracking';
import { SkeletonTable } from './Skeleton';
import { formatDate, toLocalDateString } from '../utils/localDate';
import { FORM_SECTION_BAND } from '../utils/dohFormStyle';
import { exportToXlsx } from '../utils/exportXlsx';
import { FileSpreadsheet } from 'lucide-react';

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

const AGE_GROUPS = ['4 yrs & below', '5-9 yrs', '10-14 yrs', '15-19 yrs', '20 yrs & above'];

type Period = 'daily' | 'monthly' | 'quarterly' | 'annual';
const PERIODS: { v: Period; l: string }[] = [
  { v: 'daily', l: 'Daily' },
  { v: 'monthly', l: 'Monthly' },
  { v: 'quarterly', l: 'Quarterly' },
  { v: 'annual', l: 'Annual' },
];

/** Inclusive start / exclusive end for the period containing `anchor`.
 *  Built from local date parts, not UTC — a consultation is filed under the
 *  clinic's calendar day, which is the same reason `toLocalDateString` exists. */
function periodRange(anchor: string, period: Period): { start: Date; end: Date; label: string } {
  const [y, m, d] = anchor.split('-').map(Number);
  const startOfDay = new Date(y, m - 1, d);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtMon = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  if (period === 'daily') {
    const end = new Date(y, m - 1, d + 1);
    return { start: startOfDay, end, label: fmt(startOfDay) };
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
    return { start, end, label: `${fmtMon(start)} – ${fmtMon(new Date(y, qStart + 2, 1))}` };
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
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  const t = on ? new Date(on) : new Date();
  if (Number.isNaN(t.getTime())) return null;
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
};

const ageGroupOf = (age: number | null) => {
  if (age === null) return '';
  if (age <= 4) return AGE_GROUPS[0];
  if (age <= 9) return AGE_GROUPS[1];
  if (age <= 14) return AGE_GROUPS[2];
  if (age <= 19) return AGE_GROUPS[3];
  return AGE_GROUPS[4];
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
 *  ⚠ `unverified` marks a caption that is still a GUESS. Most were resolved on
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
 *  and counted in the note above the table. CHECK AGAINST THE PAPER FORM. */
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
  treatments: string[];
  /** Tooth counts per treatment code, for the form's tooth-count columns. */
  toothCounts: Record<string, number>;
  /** Tooth counts per CONDITION code — the form's d/f/x and D/M/F/X columns
   *  plus the two Sound counts. */
  conditions: Record<string, number>;
  /** Any permanent tooth charted, for the form's "5 Year Old with Permanent
   *  Dentition" column. FDI: permanent 11-48, primary 51-85. */
  hasPermanentTooth: boolean;
  /** ORAL_HEALTH_CONDITION for this student, or null when none is recorded —
   *  null renders "—" rather than "0", which would claim a negative finding
   *  where there was simply no examination. */
  oral: { gum: boolean; debris: boolean; calculus: boolean; anomaly: boolean } | null;
  /** Sprint 81's facility_based on the first visit. Null = not recorded. */
  facilityBased: boolean | null;
  /** Orally fit on examination — `useStudents`' own oralStatus, the same
   *  source the dashboard and the Program Report's OFC row read. */
  orallyFit: boolean;
  /** Most recent PAST and next FUTURE appointment, from APPOINTMENT. */
  lastVisit: string | null;
  nextVisit: string | null;
};
type ServiceCol = {
  group: 'ORAL HEALTH STATUS' | 'FIRST' | 'SECOND' | 'OTHER SERVICES' | 'ORALLY FIT CHILD' | 'DENTAL VISIT';
  label: string;
  value?: (r: Row) => string;
  unverified?: boolean;
};

// ⚠ 'Oral Hygiene Instruction' was REMOVED 2026-09-03: the workbook's FIRST
// block is columns AH-AO, eight columns, and no Oral Hygiene Instruction is
// among them. It was read into the app off the illegible Appendix E scan.
const PREVENTIVE_SET = (visitDone: (r: Row) => boolean, isSecond: boolean): Omit<ServiceCol, 'group'>[] => [
  { label: 'Oral screening', value: (r) => (visitDone(r) ? '✓' : '') },
  { label: 'Caries Risk assessment - Low', value: (r) => (!isSecond && r.risk === 'Low' ? '✓' : '') },
  { label: 'Caries Risk assessment - Moderate', value: (r) => (!isSecond && r.risk === 'Medium' ? '✓' : '') },
  { label: 'Caries Risk assessment - High', value: (r) => (!isSecond && r.risk === 'High' ? '✓' : '') },
  { label: 'Counseling' },
  { label: 'Oral Prophylaxis', value: (r) => (!isSecond && r.treatments.includes('OP') ? '✓' : '') },
  { label: 'Fluoride Varnish App', value: (r) => (r.treatments.includes('FV') ? '✓' : '') },
  { label: isSecond ? 'Complete RPC for 2nd Visit Routine Preventive Care' : 'Complete RPC for 1st Visit Routine Preventative Care', unverified: isSecond },
];

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
const dmftPerm = (r: Row) => (r.conditions['D'] ?? 0) + (r.conditions['M'] ?? 0) + (r.conditions['F'] ?? 0);
const dftTemp = (r: Row) => (r.conditions['d'] ?? 0) + (r.conditions['f'] ?? 0);
const yesNo = (b: boolean) => (b ? '1' : '0');

const STATUS_COLUMNS: ServiceCol[] = [
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience', value: (r) => yesNo(dmftPerm(r) + dftTemp(r) > 0) },
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience in Temporary Dentition', value: (r) => yesNo(dftTemp(r) > 0) },
  { group: 'ORAL HEALTH STATUS', label: 'With Caries experience in Permanent Dentition', value: (r) => yesNo(dmftPerm(r) > 0) },
  // Age 5 AND any permanent tooth charted — the form asks this of five-year-olds
  // only, so it stays blank at every other age rather than printing a "0" that
  // reads as an answer.
  { group: 'ORAL HEALTH STATUS', label: '5 Year Old with Permanent Dentition', value: (r) => (r.age === 5 ? yesNo(r.hasPermanentTooth) : '') },
  { group: 'ORAL HEALTH STATUS', label: 'With Active Dental Caries', value: (r) => yesNo((r.conditions['D'] ?? 0) + (r.conditions['d'] ?? 0) > 0) },
  { group: 'ORAL HEALTH STATUS', label: 'Gum/Perio Disease', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.gum)) },
  { group: 'ORAL HEALTH STATUS', label: 'Oral Debris', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.debris)) },
  { group: 'ORAL HEALTH STATUS', label: 'Calcular Deposits', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.calculus)) },
  { group: 'ORAL HEALTH STATUS', label: 'Dento-Facial Anomaly', value: (r) => (r.oral === null ? NO_SOURCE : yesNo(r.oral.anomaly)) },
  // On the form; impossible for a school roll and recorded nowhere.
  { group: 'ORAL HEALTH STATUS', label: 'Completely Edentulous / No Dentition' },
  { group: 'ORAL HEALTH STATUS', label: 'd', value: (r) => String(r.conditions['d'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'f', value: (r) => String(r.conditions['f'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'x', value: (r) => String(r.conditions['x'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Sound Temporary Tooth/Teeth', value: (r) => String(r.conditions[SOUND_TEMPORARY] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'D', value: (r) => String(r.conditions['D'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'M', value: (r) => String(r.conditions['M'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'F', value: (r) => String(r.conditions['F'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'X', value: (r) => String(r.conditions['X'] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Sound Permanent Tooth/Teeth', value: (r) => String(r.conditions[SOUND_PERMANENT] ?? '') },
  { group: 'ORAL HEALTH STATUS', label: 'Caries Free', value: (r) => yesNo(dmftPerm(r) + dftTemp(r) === 0) },
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
  { group: 'OTHER SERVICES', label: 'ART/Glass Ionomer Filling (Tooth Count)', value: (r) => String(r.toothCounts['TR'] ?? '') },
  { group: 'OTHER SERVICES', label: 'Temporary Filling (Tooth Count)', value: (r) => String(r.toothCounts['TF'] ?? '') },
  { group: 'OTHER SERVICES', label: 'Extraction (Tooth Count)', value: (r) => String(r.toothCounts['X'] ?? '') },
  // 'Removal of Plaque / Calculus' REMOVED 2026-09-03 — confirmed absent from
  // the workbook, like 'Complete Health Record' before it. Both were read off
  // the illegible Appendix E scan.
  { group: 'OTHER SERVICES', label: 'Pit and Fissure Sealant (Tooth Count)', value: (r) => String(r.toothCounts['PFS'] ?? '') },
  // The form has a 1st AND a 2nd SDF column, both tooth counts. The app had a
  // tick for the 1st and a blank for the 2nd.
  { group: 'OTHER SERVICES', label: '1st Silver Diamine Fluoride App (tooth count)', value: (r) => String(r.toothCounts['SDF'] ?? '') },
  { group: 'OTHER SERVICES', label: '2nd Silver Diamine Fluoride App (tooth count)' },
  { group: 'OTHER SERVICES', label: 'Gum Treatment - Scaling' },
  { group: 'OTHER SERVICES', label: 'Gum Treatment - Prescription' },
  { group: 'OTHER SERVICES', label: 'Consultation' },
  { group: 'OTHER SERVICES', label: 'Referred Out' },
  { group: 'OTHER SERVICES', label: 'Complete Mouth Rehab' },

  // The form's "Orally Fit Child" pair and its two visit-date columns, banded
  // under their own headings after the services — they are an assessment and
  // two dates, not services.
  { group: 'ORALLY FIT CHILD', label: 'Upon Oral Examination', value: (r) => (r.orallyFit ? '✓' : '') },
  // Nothing records a completed mouth rehabilitation, so this stays blank
  // rather than reusing the examination answer, which would double-count.
  { group: 'ORALLY FIT CHILD', label: 'After Complete Mouth Rehabilitation' },
  { group: 'DENTAL VISIT', label: 'Last Dental Visit', value: (r) => (r.lastVisit ? formatDate(r.lastVisit) : '') },
  { group: 'DENTAL VISIT', label: 'Next Dental Visit', value: (r) => (r.nextVisit ? formatDate(r.nextVisit) : '') },
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

export const TargetClientList = () => {
  const { selectedSchool } = useAuth();
  const { students, loading: studentsLoading } = useStudents();
  const { records: rpcRecords, loading: rpcLoading } = useRPCTracking();
  // The list hooks drop address / contact / PhilHealth, which the TCL needs, so
  // the raw records are fetched alongside them for those three fields only.
  const [raw, setRaw] = useState<ApiStudent[]>([]);
  const [rawError, setRawError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('monthly');
  const [anchor, setAnchor] = useState(() => toLocalDateString(new Date()));

  // Appointments back the form's Last / Next Dental Visit columns. Fetched
  // here rather than added to useRPCTracking: no other consumer of that hook
  // needs them, and it already pulls six collections.
  const [appointments, setAppointments] = useState<ApiAppointment[]>([]);
  const [busy, setBusy] = useState<'xlsx' | null>(null);
  const [orals, setOrals] = useState<ApiOralHealthCondition[]>([]);
  const [iptrs, setIptrs] = useState<ApiStudentIptr[]>([]);

  useEffect(() => {
    apiClient.get<ApiStudent[]>('/students')
      .then(setRaw)
      .catch(() => setRawError('Could not load address and PhilHealth details.'));
    apiClient.get<ApiAppointment[]>('/appointments')
      .then(setAppointments)
      .catch(() => setAppointments([]));
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

    const now = Date.now();
    const apptsByStudent = new Map<string, { past: number[]; future: number[] }>();
    for (const a of appointments) {
      const t = new Date(a.appointment_datetime).getTime();
      if (Number.isNaN(t)) continue;
      const b = apptsByStudent.get(a.student_id) ?? { past: [], future: [] };
      (t <= now ? b.past : b.future).push(t);
      apptsByStudent.set(a.student_id, b);
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
          treatments: r?.treatmentCodes ?? [],
          toothCounts: r?.treatmentToothCounts ?? {},
          conditions: r?.conditionToothCounts ?? {},
          hasPermanentTooth: (r?.conditionToothCounts ?? {})[SOUND_PERMANENT] > 0
            || ['D', 'M', 'F', 'X'].some((c) => ((r?.conditionToothCounts ?? {})[c] ?? 0) > 0),
          oral: oralByStudent.get(s.id) ?? null,
          facilityBased: r?.visit1FacilityBased ?? null,
          orallyFit: s.oralStatus === 'Orally Fit',
          lastVisit: (() => {
            const p = apptsByStudent.get(s.id)?.past ?? [];
            return p.length ? toLocalDateString(new Date(Math.max(...p))) : null;
          })(),
          nextVisit: (() => {
            const f = apptsByStudent.get(s.id)?.future ?? [];
            return f.length ? toLocalDateString(new Date(Math.min(...f))) : null;
          })(),
        };
      });
  }, [students, rpcRecords, raw, appointments, orals, iptrs, selectedSchool]);

  const { start, end, label: periodLabel } = useMemo(() => periodRange(anchor, period), [anchor, period]);

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
  const onXlsx = async () => {
    setBusy('xlsx');
    try {
      const cols = [
        ...visibleIdentity.map((c) => ({
          label: c.label,
          value: (r: { row: Row; i: number }) => String(c.value(r.row, r.i) ?? ''),
        })),
        ...visibleServices.map((c) => ({
          label: `${c.group} — ${c.label}`,
          value: (r: { row: Row; i: number }) => String(c.value ? c.value(r.row) : NO_SOURCE),
        })),
        ...(remarksVisible ? [{ label: 'REMARKS (Specify other findings)', value: () => '' }] : []),
      ];
      await exportToXlsx(
        visible.map((row, i) => ({ row, i })),
        cols,
        `${exportBaseName}.xlsx`,
        'Target Client List',
      );
    } finally {
      setBusy(null);
    }
  };

  if (studentsLoading || rpcLoading) return <SkeletonTable rows={8} />;

  const IDENTITY_COLUMNS: IdentityCol[] = [
    { key: 'no', label: 'No.', value: (_r, i) => i + 1 },
    { key: 'consult', label: 'Date of consultation', head: <>Date of<br />consultation</>, value: (r) => (r.consultDate ? formatDate(r.consultDate) : '') },
    // Column C of the real form. Sprint 81 gave it a source; null stays blank
    // rather than printing "0 - No", which would be a claim, not a blank.
    { key: 'facility', label: 'Facility Based', rotate: true, head: <>Facility Based<br /><span className="font-normal">0 - No · 1 - Yes</span></>, value: (r) => (r.facilityBased === null ? NO_SOURCE : r.facilityBased ? '1' : '0') },
    // On the real form, no source in Floral — STUDENT has no family serial and
    // no barangay field (address is one free-text line).
    { key: 'familyserial', label: 'Family Serial Number', value: () => NO_SOURCE },
    { key: 'barangay', label: 'Barangay', rotate: true, value: () => NO_SOURCE },
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

  const tick = (on: boolean) => (on ? '✓' : '');
  const hasCode = (codes: string[], code: string) => (codes.includes(code) ? '✓' : '');

  // Header geometry copied from the paper form (Appendix E, both sheets).
  // There, the header is ONE uniform tall band across the whole width: wide
  // identity columns carry horizontal labels centred in that band, and the
  // narrow service columns carry labels rotated to read bottom-to-top. That is
  // what lets ~26 columns fit a printable width without the labels setting the
  // column widths. Rendering them all horizontally, as this did before, made
  // the band short and every service column at least as wide as its caption.
  const HEADER_H = 'h-44';
  const th = 'px-2 py-2 text-[11px] font-semibold text-foreground border border-border whitespace-nowrap';
  // Horizontal caption, vertically centred in the tall band.
  const thFlat = `${th} align-middle text-center`;
  // Rotated caption. `vertical-rl` + 180° reads bottom-to-top, matching the
  // form; the fixed width is what actually narrows the column.
  const thRot = `${th} align-bottom p-1 w-8`;
  const rotStyle: CSSProperties = {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    // Keeps the glyphs upright inside the rotated flow rather than laid on
    // their side, which is how the printed form reads.
    textOrientation: 'mixed',
    whiteSpace: 'nowrap',
    margin: '0 auto',
  };
  /** A rotated column caption, sized to the shared band height. */
  const RotHead = ({ label, tone = '', unverified = false }: { label: string; tone?: string; unverified?: boolean }) => (
    <th className={`${thRot} ${tone}`}>
      {/* Dotted underline marks a caption read off the low-res Appendix E scan
          that still needs checking against the paper form. */}
      <div
        style={rotStyle}
        className={`mx-auto leading-tight ${unverified ? 'border-b border-dotted border-amber-500' : ''}`}
        title={unverified ? 'Caption unverified — check against the paper DOH form' : undefined}
      >{label}</div>
    </th>
  );
  const td = 'px-2 py-1.5 text-xs text-foreground border border-border whitespace-nowrap';

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold text-foreground">Target Client List for Oral Health Care and Services</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {PERIODS.map((p) => (
              <button
                key={p.v}
                onClick={() => setPeriod(p.v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p.v ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >{p.l}</button>
            ))}
          </div>
          {/* Native date input, per the house rule on preferring platform
              features. It anchors the period — the buttons decide how much of
              the calendar around this date is covered. */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Period containing
            <input
              type="date"
              value={anchor}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {/* Excel ONLY, deliberately — no PDF button here (decided
              2026-09-03). This table is 66 columns; Excel paginates columns
              natively where a PDF is either unreadably small or sprayed across
              pages, which is the same width problem the print stylesheet has
              never solved. It is also the format the City Health Office
              requires. Do not "add the missing PDF export". */}
          <div className="flex items-center gap-2">
            <button
              onClick={onXlsx}
              disabled={busy !== null || visible.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          <button
            onClick={() => setShowPicker((v) => !v)}
            aria-expanded={showPicker}
            className="float-right ml-3 text-xs px-2 py-1 border border-border rounded-md text-foreground hover:bg-gray-50"
          >{showPicker ? 'Done' : `Columns${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`}</button>
          <span className="font-semibold text-foreground">{periodLabel}</span> — showing {visible.length} client
          {visible.length !== 1 ? 's' : ''} consulted{selectedSchool ? ' at the selected school' : ' across all schools'}.
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

      {/* Scrolls inside its own container, like the DOH table — the form is far
          wider than any screen and the page itself must never scroll sideways. */}
      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="border-collapse">
          <thead className="bg-gray-50">
            {/* Group band — thin, above the tall caption band, exactly as the
                paper form runs FIRST / SECOND / OTHER SERVICES across the top.
                Spans are computed from the VISIBLE columns (Sprint 72). */}
            <tr>
              {visibleIdentity.length > 0 && <th className={th} colSpan={visibleIdentity.length} />}
              {visibleServiceGroups.map((g) => (
                <th key={g.label} colSpan={g.span}
                    // Group bands carry the printed form's amber (Sprint 83);
                    // the identity block keeps its cooler tone so the two
                    // halves of the sheet stay distinguishable.
                    className={`${th} ${g.label === 'OTHER SERVICES' ? FORM_SECTION_BAND : 'bg-blue-50'}`}>
                  {g.label}
                </th>
              ))}
              {remarksVisible && <th className={th} />}
            </tr>
            <tr className={HEADER_H}>
              {visibleIdentity.map((c) => (
                c.rotate
                  ? <RotHead key={c.key} label={c.label} />
                  : <th key={c.key} className={thFlat}>{c.head ?? c.label}</th>
              ))}
              {visibleServices.map((c, i) => (
                <RotHead
                  key={`${c.group}-${c.label}-${i}`}
                  label={c.label}
                  tone={c.group === 'OTHER SERVICES' ? FORM_SECTION_BAND : 'bg-blue-50'}
                  unverified={c.unverified}
                />
              ))}
              {remarksVisible && <th className={thFlat}>Remarks</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td className={`${td} text-center text-muted-foreground`} colSpan={visibleIdentity.length + visibleServices.length + (remarksVisible ? 1 : 0)}>No clients consulted in this period.</td></tr>
            ) : visible.map((r, i) => (
              <tr key={r.id} className="hover:bg-gray-50">
                {visibleIdentity.map((c) => (
                  <td key={c.key} className={`${td} ${c.cls ?? ''}`}
                      title={c.key === 'address' ? r.address : undefined}>
                    {c.value(r, i)}
                  </td>
                ))}
                {visibleServices.map((c, n) => (
                  <td key={`${c.group}-${c.label}-${n}`}
                      className={`${td} text-center ${c.value ? '' : 'text-muted-foreground'}`}>
                    {c.value ? c.value(r) : NO_SOURCE}
                  </td>
                ))}
                {remarksVisible && <td className={td} />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
