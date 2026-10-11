// ─── RPC (two-visit preventive care) roll-up, shared by server and client ──
//
// Sprint 140. This join used to run in the BROWSER, so the RPC Tracking page
// pulled SIX whole collections — students, schools, IPTRs, preventive-care
// records, dental charts and tooth records — to draw one list.
//
// MOVED, not copied. The 4-6 month window, the school-year cutoff and the
// tooth-count roll-ups decide what a DOH return reports; a second copy would
// drift, and the drift would be invisible until two screens disagreed.
//
// Nothing here may import mongoose or React.

import { schoolYearEnd } from './schoolYear.js';
import { surnameFirst } from './studentName.js';

export interface RpcStudent {
  _id: string;
  school_id: string;
  sex: string;
  birthday: string;
  grade_level: string;
  section: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  full_name?: string;
}
export interface RpcSchool { _id: string; school_name: string }
export interface RpcIptr { _id: string; student_id: string; school_year: string }
export interface RpcPreventive {
  _id: string;
  iptr_id: string;
  visit_date: string;
  visit_number: number;
  facility_based?: boolean | null;
  oral_screening?: boolean | null;
  oral_prophylaxis?: boolean | null;
  fluoride_varnish?: boolean | null;
  oral_hygiene_instruction?: boolean | null;
  caries_risk?: 'Low' | 'Moderate' | 'High' | null;
}

/** What was done at ONE visit. ⚠ Every field is nullable and null means NOT
 *  RECORDED — the Target Client List prints a blank for it, never a "no". */
export interface VisitServices {
  oralScreening: boolean | null;
  oralProphylaxis: boolean | null;
  fluorideVarnish: boolean | null;
  oralHygieneInstruction: boolean | null;
  cariesRisk: 'Low' | 'Moderate' | 'High' | null;
}
export interface RpcChart { _id: string; iptr_id: string }
export interface RpcTooth {
  chart_id: string;
  tooth_number: number;
  condition?: string | null;
  treatment_code?: string | null;
}

export interface RpcInput {
  students: RpcStudent[];
  schools: RpcSchool[];
  iptrs: RpcIptr[];
  preventives: RpcPreventive[];
  charts: RpcChart[];
  toothRecords: RpcTooth[];
  /** "Now" for the due-date arithmetic. Passed in so a result is reproducible. */
  now?: number;
}

// "4-6 month interval" per the RPC module description — 150 days is the midpoint.
const RPC_INTERVAL_DAYS = 150;
// Lower bound of the 4–6 month window (~4 months). Visit 2 done sooner than this
// is flagged as early — done before the recommended minimum spacing.
const RPC_MIN_INTERVAL_DAYS = 120;
// Upper bound of the window (~6 months).
const RPC_MAX_INTERVAL_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Synthetic condition keys for the two Sound columns the DOH Target Client
 *  List prints. Not real tooth codes — '✓' is stored for both dentitions, so
 *  the split is made when counting (see conditionToothCounts). */
export const SOUND_TEMPORARY = 'sound_temporary';
export const SOUND_PERMANENT = 'sound_permanent';

// Visit 2 only counts for DOH/PhilHealth if it lands within the same school
// year as Visit 1 (June–April, per the dentist: "kailangan pumasok siya sa
// school calendar"). The rule itself now lives in utils/schoolYear.ts, shared
// with the appointments window so the two cannot drift.

export interface RPCRow {
  id: string;
  studentName: string;
  birthdate: string;
  gender: string;
  school: string;
  grade: string;
  section: string;
  visit1Date: string | null;
  visit1Status: 'Completed' | 'Pending';
  visit2Date: string | null;
  visit2Status: 'Completed' | 'Pending';
  daysUntilDue: number;
  status: 'complete' | 'pending' | 'overdue' | 'not-started';
  earlyVisit2: boolean;
  // School-year cutoff for a still-pending Visit 2: 'tight' = the 4–6 month
  // window extends past April 30, so Visit 2 must be done by then (earlier
  // than the usual deadline) to count; 'impossible' = even the earliest legal
  // Visit 2 (+4 months) lands after the school year ends — it can't be
  // counted for DOH/PhilHealth this school year.
  syCutoff: 'tight' | 'impossible' | null;
  syDeadline: string | null; // the April 30 the window is cut by (YYYY-MM-DD)
  // Distinct TOOTH_RECORD.treatment_code values recorded anywhere on this
  // student's dental charts (OEX, FV, PFS, …). NOTE: this is "the student has
  // had this treatment", NOT "this was done at the RPC visit" —
  // PREVENTIVE_CARE_RECORD stores no services at all (iptr_id, visit_date,
  // visit_number only), so per-visit treatment data does not exist to filter on.
  treatmentCodes: string[];
  /** TOOTH COUNT per treatment code, e.g. { PFS: 4, TF: 2 }. The Target Client
   *  List has genuine tooth-count columns (Pit and Fissure Sealant, Temporary
   *  Filling, 2nd SDF application) where `treatmentCodes` above only answers
   *  "did this student ever have it". Same caveat as that field: this counts
   *  TOOTH_RECORDs across the student's charts, not services at a given visit —
   *  per-visit services are still recorded nowhere. */
  treatmentToothCounts: Record<string, number>;
  /** TOOTH COUNT per CONDITION code — the form's `d f D M F X` columns, plus
   *  the sound-teeth counts. Case encodes the dentition (`DentalChart`'s
   *  conditionCodes: permanent uppercase, temporary lowercase), so counting the
   *  exact stored string separates primary from permanent with no extra lookup.
   *  Distinct from `treatmentToothCounts`, which counts what was DONE; this
   *  counts what was FOUND. */
  conditionToothCounts: Record<string, number>;
  /** Services recorded AT visit 1 and visit 2 (Sprint 147), or null when that
   *  visit does not exist yet.
   *
   *  ⚠ THIS IS WHY THEY EXIST: before this, the Target Client List answered
   *  "has this pupil EVER had fluoride varnish?" from the dental chart, where
   *  the form asks "was it done at THIS visit?". `treatmentCodes` below still
   *  answers the first question and is still the right source for the
   *  chart-derived columns — these two answer the second. */
  visit1Services: VisitServices | null;
  visit2Services: VisitServices | null;
  /** `facility_based` of the FIRST recorded visit (Sprint 81) — the visit the
   *  TCL's "Date of consultation" column reports. Null = not recorded, which is
   *  every visit created before Sprint 81; it must NOT be shown as "No". */
  visit1FacilityBased: boolean | null;
  /** This student's IPTR id keyed by school year, e.g. { '2025-2026': '…' }.
   *
   *  A new visit attaches to the IPTR for the school year of THE VISIT DATE,
   *  not of today: a visit backdated to March belongs to the school year that
   *  was running in March. Resolving it at save time (rather than pinning the
   *  current year here) is both more correct and the difference between the
   *  control being usable and not — the demo database has 26 IPTRs on
   *  2025-2026 and 2 on 2026-2027, so a "current year only" rule would refuse
   *  24 of 26 students.
   *
   *  When no IPTR exists for the chosen date's school year, recording is
   *  blocked rather than silently filed against another year — that is the bug
   *  class Sprint 57a fixed for grades. */
  iptrIdBySchoolYear: Record<string, string>;
  /** Which visit the clinic would record next, or null when both are done. */
  nextVisitNumber: 1 | 2 | null;
}


export function buildRpcRows(input: RpcInput): RPCRow[] {
  const { students, schools, iptrs, preventives, charts, toothRecords } = input;

const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
const iptrsByStudent = new Map<string, RpcIptr[]>();
for (const iptr of iptrs) {
  const list = iptrsByStudent.get(iptr.student_id) ?? [];
  list.push(iptr);
  iptrsByStudent.set(iptr.student_id, list);
}
const preventivesByIptr = new Map<string, RpcPreventive[]>();
for (const p of preventives) {
  const list = preventivesByIptr.get(p.iptr_id) ?? [];
  list.push(p);
  preventivesByIptr.set(p.iptr_id, list);
}

// student → set of treatment codes, resolved through
// TOOTH_RECORD → DENTAL_CHART → STUDENT_IPTR → STUDENT.
const codesByChart = new Map<string, Set<string>>();
// Counts alongside the set: the TCL has real tooth-count columns, and a
// Set can only answer "ever had it". Counted per chart first so the
// chart → iptr → student roll-up below adds rather than overwrites.
const countsByChart = new Map<string, Record<string, number>>();
const condByChart = new Map<string, Record<string, number>>();
for (const tr of toothRecords) {
  if (tr.condition) {
    // Every code except Sound already encodes its dentition by case
    // (D/d, F/f, X/x). Sound is '✓' for BOTH, so it is split here by
    // FDI tooth number — permanent 11-48, primary 51-85 — because the
    // form has separate "Sound Temporary" and "Sound Permanent"
    // columns and the code alone cannot tell them apart.
    const key = tr.condition === '✓'
      ? (tr.tooth_number >= 51 ? SOUND_TEMPORARY : SOUND_PERMANENT)
      : tr.condition;
    const cc = condByChart.get(tr.chart_id) ?? {};
    cc[key] = (cc[key] ?? 0) + 1;
    condByChart.set(tr.chart_id, cc);
  }
  if (!tr.treatment_code) continue;
  const set = codesByChart.get(tr.chart_id) ?? new Set<string>();
  set.add(tr.treatment_code);
  codesByChart.set(tr.chart_id, set);
  const counts = countsByChart.get(tr.chart_id) ?? {};
  counts[tr.treatment_code] = (counts[tr.treatment_code] ?? 0) + 1;
  countsByChart.set(tr.chart_id, counts);
}
const codesByIptr = new Map<string, Set<string>>();
const countsByIptr = new Map<string, Record<string, number>>();
const condByIptr = new Map<string, Record<string, number>>();
// Conditions roll up on their own loop: a chart can carry conditions
// with no treatments at all, and the treatment loop below `continue`s
// past exactly those charts.
for (const chart of charts) {
  const cc = condByChart.get(chart._id);
  if (!cc) continue;
  const acc = condByIptr.get(chart.iptr_id) ?? {};
  for (const [code, n] of Object.entries(cc)) acc[code] = (acc[code] ?? 0) + n;
  condByIptr.set(chart.iptr_id, acc);
}
for (const chart of charts) {
  const codes = codesByChart.get(chart._id);
  if (!codes) continue;
  const set = codesByIptr.get(chart.iptr_id) ?? new Set<string>();
  for (const c of codes) set.add(c);
  codesByIptr.set(chart.iptr_id, set);
  const acc = countsByIptr.get(chart.iptr_id) ?? {};
  for (const [code, n] of Object.entries(countsByChart.get(chart._id) ?? {})) {
    acc[code] = (acc[code] ?? 0) + n;
  }
  countsByIptr.set(chart.iptr_id, acc);
}

const now = input.now ?? Date.now();

const rows: RPCRow[] = students.map((s) => {
  const studentIptrs = iptrsByStudent.get(s._id) ?? [];
  const allVisits = studentIptrs.flatMap((iptr) => preventivesByIptr.get(iptr._id) ?? []);
  const visit1 = allVisits.find((v) => v.visit_number === 1) ?? null;
  const visit2 = allVisits.find((v) => v.visit_number === 2) ?? null;
  const servicesOf = (v: RpcPreventive | null): VisitServices | null =>
    v
      ? {
          oralScreening: v.oral_screening ?? null,
          oralProphylaxis: v.oral_prophylaxis ?? null,
          fluorideVarnish: v.fluoride_varnish ?? null,
          oralHygieneInstruction: v.oral_hygiene_instruction ?? null,
          cariesRisk: v.caries_risk ?? null,
        }
      : null;

  let status: RPCRow['status'] = 'not-started';
  let daysUntilDue = 0;
  let earlyVisit2 = false;
  let syCutoff: RPCRow['syCutoff'] = null;
  let syDeadline: string | null = null;
  if (visit1 && visit2) {
    status = 'complete';
    const gapDays = Math.floor(
      (new Date(visit2.visit_date).getTime() - new Date(visit1.visit_date).getTime()) / MS_PER_DAY,
    );
    earlyVisit2 = gapDays >= 0 && gapDays < RPC_MIN_INTERVAL_DAYS;
  } else if (visit1) {
    const visit1Time = new Date(visit1.visit_date).getTime();
    const daysSinceVisit1 = Math.floor((now - visit1Time) / MS_PER_DAY);
    daysUntilDue = RPC_INTERVAL_DAYS - daysSinceVisit1;
    status = daysUntilDue < 0 ? 'overdue' : 'pending';
    const syEnd = schoolYearEnd(new Date(visit1.visit_date));
    const windowOpens = visit1Time + RPC_MIN_INTERVAL_DAYS * MS_PER_DAY;
    const windowCloses = visit1Time + RPC_MAX_INTERVAL_DAYS * MS_PER_DAY;
    if (windowOpens > syEnd.getTime()) syCutoff = 'impossible';
    else if (windowCloses > syEnd.getTime()) syCutoff = 'tight';
    if (syCutoff) {
      syDeadline = `${syEnd.getFullYear()}-${String(syEnd.getMonth() + 1).padStart(2, '0')}-${String(syEnd.getDate()).padStart(2, '0')}`;
    }
  }

  return {
    id: s._id,
    // surnameFirst, not full_name: full_name is "First Middle Last",
    // so this list displayed given-name-first while every other list
    // showed surname-first, and sorting it would have ordered by given
    // name. Sprint 35 made surname-first the house convention.
    studentName: surnameFirst(s),
    birthdate: s.birthday.slice(0, 10),
    gender: s.sex,
    school: schoolNameById.get(s.school_id) ?? 'Unknown School',
    grade: s.grade_level,
    section: s.section,
    visit1Date: visit1 ? visit1.visit_date.slice(0, 10) : null,
    visit1Status: visit1 ? 'Completed' : 'Pending',
    visit2Date: visit2 ? visit2.visit_date.slice(0, 10) : null,
    visit2Status: visit2 ? 'Completed' : 'Pending',
    daysUntilDue,
    status,
    earlyVisit2,
    syCutoff,
    syDeadline,
    treatmentCodes: [...new Set(studentIptrs.flatMap((iptr) => [...(codesByIptr.get(iptr._id) ?? [])]))],
    treatmentToothCounts: studentIptrs.reduce<Record<string, number>>((acc, iptr) => {
      for (const [code, n] of Object.entries(countsByIptr.get(iptr._id) ?? {})) acc[code] = (acc[code] ?? 0) + n;
      return acc;
    }, {}),
    conditionToothCounts: studentIptrs.reduce<Record<string, number>>((acc, iptr) => {
      for (const [code, n] of Object.entries(condByIptr.get(iptr._id) ?? {})) acc[code] = (acc[code] ?? 0) + n;
      return acc;
    }, {}),
    visit1Services: servicesOf(visit1),
    visit2Services: servicesOf(visit2),
    visit1FacilityBased: visit1?.facility_based ?? null,
    iptrIdBySchoolYear: Object.fromEntries(studentIptrs.map((i) => [i.school_year, i._id])),
    nextVisitNumber: !visit1 ? 1 : !visit2 ? 2 : null,
  };
});

  // Alphabetical by surname, matching every other list (2026-09-02).
  rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
  return rows;
}

// ─── Filtering and paging (Sprint 146) ─────────────────────────────────────
//
// The same move as Sprint 145 made on Risk Classification, for the same
// reason: this page filtered the whole population in the browser, so the
// endpoint had to send every pupil (685 B/row, ~5.5 MB at 8,000). Paging the
// query while any filter stayed client-side would have filtered only the
// visible page.

import { getAgeGroup, calculateAge } from './age.js';

export interface RpcListQuery {
  q?: string;
  /** The school context — client-side scoping here would make the page count
   *  describe a roll the user is not looking at. */
  school?: string;
  grade?: string;
  section?: string;
  gender?: string;
  ageGroup?: string;
  /** 'outstanding' (the resting value) hides completed pairs; 'all' shows
   *  everything; anything else matches RPCRow.status exactly. */
  status?: string;
  /** A TOOTH_RECORD treatment code the pupil has had at some point. */
  treatment?: string;
  limit?: number;
  offset?: number;
}

export interface RpcListPage {
  rows: RPCRow[];
  /** Rows matching the filters, before paging — the "of N" in the pager. */
  total: number;
  /** Rows in the school context before any other filter, for the pager's
   *  "(filtered from N)" note. */
  schoolTotal: number;
  /** Sections present in the school context, narrowed to the chosen grade —
   *  computed over the POPULATION, never the page, or the dropdown would hide
   *  the section you need to pick next. */
  sectionOptions: string[];
  /** Population-wide counts for the dashboard funnel — never page-scoped. */
  funnel: { enrolled: number; visit1: number; both: number; overdue: number; complete: number };
}

export function filterRpcRows(all: RPCRow[], query: RpcListQuery): RpcListPage {
  const inSchool = query.school ? all.filter((r) => r.school === query.school) : all;
  const q = (query.q ?? '').toLowerCase();

  const rows = inSchool.filter((r) => {
    if (query.grade && query.grade !== 'all' && r.grade !== query.grade) return false;
    if (query.section && query.section !== 'all' && r.section !== query.section) return false;
    if (query.gender && query.gender !== 'all' && r.gender !== query.gender) return false;
    if (query.ageGroup && query.ageGroup !== 'all' && getAgeGroup(calculateAge(r.birthdate)) !== query.ageGroup) return false;
    if (query.status === 'outstanding') {
      if (r.status === 'complete') return false;
    } else if (query.status && query.status !== 'all' && r.status !== query.status) {
      return false;
    }
    if (query.treatment && query.treatment !== 'all' && !r.treatmentCodes.includes(query.treatment)) return false;
    if (q && !r.studentName.toLowerCase().includes(q)) return false;
    return true;
  });

  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit && query.limit > 0 ? query.limit : rows.length;

  return {
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
    schoolTotal: inSchool.length,
    // ⚠ Computed over `inSchool` — the whole school population — NOT over
    // `rows` and NOT over the page. The dashboard's two-visit funnel needs
    // counts for everyone, and it used to derive them by counting the rows it
    // received: an endpoint whose status filter defaults to "outstanding",
    // which excludes by definition every pupil who finished. "Both visits
    // completed: 0" was therefore structurally impossible to beat.
    funnel: {
      enrolled: inSchool.length,
      visit1: inSchool.filter((r) => r.visit1Status === 'Completed').length,
      both: inSchool.filter((r) => r.visit2Status === 'Completed').length,
      overdue: inSchool.filter((r) => r.status === 'overdue').length,
      complete: inSchool.filter((r) => r.status === 'complete').length,
    },
    sectionOptions: [...new Set(
      inSchool.filter((r) => !query.grade || query.grade === 'all' || r.grade === query.grade).map((r) => r.section),
    )].filter(Boolean).sort(),
  };
}
