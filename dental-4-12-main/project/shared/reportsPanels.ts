// ─── Reports-page panels, shared by the server and the client ─────────────
//
// Sprint 143, the last of #24's client half. `Reports.tsx` fetched FIVE whole
// collections of its own — treatments, tooth records, dental charts, IPTRs and
// referrals — on top of the five report hooks that were already moved.
//
// Two panels are served from here:
//   · the Treatment Summary matrix (procedure x grade x sex), a COUNT shape,
//     so it stays flat whatever the roll size
//   · the Referral Tracking rows, which are one row per referral — few by
//     nature, and each one a slip a dentist wrote by hand
//
// ⚠ THE MATRIX IS KEYED BY TREATMENT CODE, NOT BY LABEL. Labels carry the
// clinic's local terms ("Bunot", "Pasta") and belong to the UI; sending them
// from the server would put display vocabulary in an API and make a label
// change a server change.
//
// Nothing here may import mongoose or React.

import { surnameFirst } from './studentName.js';

export interface PanelStudent {
  _id: string;
  school_id: string;
  sex: string;
  grade_level: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  full_name?: string;
}
export interface PanelSchool { _id: string; school_name: string }
export interface PanelIptr { _id: string; student_id: string; grade_level?: string | null }
export interface PanelChart { _id: string; iptr_id: string; date_charted: string }
export interface PanelTooth { chart_id: string; treatment_code?: string | null }
export interface PanelTreatment { iptr_id: string; date: string }
export interface PanelReferral {
  _id: string;
  iptr_id: string;
  referral_type: string;
  date_issued: string;
  facility_name: string;
  reason: string;
  follow_up_date?: string | null;
  status: string;
}

export interface ReportsPanelsInput {
  students: PanelStudent[];
  schools: PanelSchool[];
  iptrs: PanelIptr[];
  charts: PanelChart[];
  toothRecords: PanelTooth[];
  treatments: PanelTreatment[];
  referrals: PanelReferral[];
  /** Inclusive start / exclusive end of the reporting period, ISO strings. */
  from: string | null;
  to: string | null;
  /** School NAME, or null for all schools. */
  schoolName: string | null;
}

export type SexCell = { M: number; F: number };
/** `{ [treatmentCode]: { [grade | 'all']: { M, F } } }` */
export type TreatmentMatrix = Record<string, Record<string, SexCell>>;

export interface ReferralTrackingRow {
  student: string;
  school: string;
  grade: string;
  date: string;
  facility: string;
  reason: string;
  referralType: string;
  followUp: string | null;
  status: string;
}

export interface ReportsPanelsOutput {
  treatmentMatrix: TreatmentMatrix;
  /** Treatment entries inside the period + school filter. */
  periodTreatmentCount: number;
  /** Every treatment entry ever — the admin Overview card. */
  allTimeTreatmentCount: number;
  referralRows: ReferralTrackingRow[];
}

export function buildReportsPanels(input: ReportsPanelsInput): ReportsPanelsOutput {
  const { students, schools, iptrs, charts, toothRecords, treatments, referrals, from, to, schoolName } = input;

  const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
  const studentById = new Map(students.map((s) => [s._id, s]));
  const iptrById = new Map(iptrs.map((i) => [i._id, i]));
  const chartById = new Map(charts.map((c) => [c._id, c]));

  const start = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
  const end = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
  const inPeriod = (d: string) => {
    const t = new Date(d).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  };

  /** The pupil behind an IPTR, respecting the school filter. */
  const studentForIptr = (iptrId: string): PanelStudent | null => {
    const iptr = iptrById.get(iptrId);
    if (!iptr) return null;
    const student = studentById.get(iptr.student_id);
    if (!student) return null;
    if (schoolName && schoolNameById.get(student.school_id) !== schoolName) return null;
    return student;
  };

  // ── Treatment Summary ───────────────────────────────────────────────────
  // Tooth records carry no date of their own, so each is dated by its chart's
  // `date_charted` — the closest real date the ERD provides, and the UI says
  // so beneath the table.
  const treatmentMatrix: TreatmentMatrix = {};
  for (const tr of toothRecords) {
    if (!tr.treatment_code) continue;
    const chart = chartById.get(tr.chart_id);
    if (!chart || !inPeriod(chart.date_charted)) continue;
    const student = studentForIptr(chart.iptr_id);
    if (!student) continue;
    const sex: 'M' | 'F' = student.sex === 'Male' || student.sex === 'M' ? 'M' : 'F';
    const row = (treatmentMatrix[tr.treatment_code] ??= {});
    for (const g of [student.grade_level, 'all']) {
      const cell = (row[g] ??= { M: 0, F: 0 });
      cell[sex] += 1;
    }
  }

  // TREATMENT rows carry a real per-entry date, unlike tooth records.
  const periodTreatmentCount = treatments.filter(
    (t) => inPeriod(t.date) && (!schoolName || studentForIptr(t.iptr_id) !== null),
  ).length;

  // ── Referral Tracking ───────────────────────────────────────────────────
  // Not period-filtered: this panel sits in the all-time Overview section,
  // which has no period or school selector of its own.
  const referralRows: ReferralTrackingRow[] = [];
  for (const r of referrals) {
    const iptr = iptrById.get(r.iptr_id);
    if (!iptr) continue;
    const student = studentById.get(iptr.student_id);
    if (!student) continue;
    referralRows.push({
      student: surnameFirst(student),
      school: schoolNameById.get(student.school_id) ?? 'Unknown School',
      // The IPTR's own grade is the grade AT THE TIME (Sprint 57a); the
      // pupil's current grade would relabel last year's referrals.
      grade: iptr.grade_level || student.grade_level,
      date: r.date_issued,
      facility: r.facility_name,
      reason: r.reason,
      referralType: r.referral_type,
      followUp: r.follow_up_date ?? null,
      status: r.status,
    });
  }
  referralRows.sort((a, b) => b.date.localeCompare(a.date));

  return {
    treatmentMatrix,
    periodTreatmentCount,
    allTimeTreatmentCount: treatments.length,
    referralRows,
  };
}
