import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type {
  ApiSchool,
  ApiStudent,
  ApiStudentIptr,
  ApiOralHealthCondition,
  ApiDentalChart,
  ApiToothRecord,
} from '../api/types';

// ─── Per-school summary sheet ────────────────────────────────────────────────
// Source of the tallies behind SchoolSummaryReport — the one-page sheet the
// dentist keeps per school (supplied 2026-09-03 as a scan headed
// "SOUTH DAANG HARI"). Its columns are MALE | TOTAL | FEMALE | TOTAL, and the
// user confirmed the reading 2026-09-03: **MALE/FEMALE count STUDENTS, each
// TOTAL counts TEETH.** So every figure has two shapes and they are tallied
// separately here — a person is counted once no matter how many teeth carry
// the code, and the teeth are counted in full.
//
// Scoped to one school AND one school year, like every other DOH report since
// Sprint 57b. The join runs student → IPTR (that year) → dental charts → tooth
// records, which is why the year scoping is exact rather than approximate:
// DENTAL_CHART hangs off `iptr_id`, and an IPTR belongs to exactly one year.

/** Tooth CONDITION codes the sheet reports, in its own order.
 *  Case is the dentition (DentalChart's conditionCodes: permanent uppercase,
 *  temporary lowercase), so counting the stored string needs no tooth-number
 *  lookup.
 *  ⚠ The sheet asks for (D)(M)(F)(X) but only (d)(f)(x) — there is deliberately
 *  NO temporary (m). That is the standard dft convention: a missing primary
 *  tooth is usually natural exfoliation, not disease. Do not "complete" the
 *  set. */
export const PERMANENT_CODES = ['D', 'M', 'F', 'X'] as const;
export const TEMPORARY_CODES = ['d', 'f', 'x'] as const;

/** Derived row: caries = decayed teeth in either dentition. There is no
 *  `dental_caries` boolean on ORAL_HEALTH_CONDITION (checked — the model has
 *  gingivitis, periodontal_disease, debris, calculus, abnormal_growth,
 *  cleft_lip_palate), so the tooth records are the only source, and they are
 *  the better one: they carry a count as well as a yes/no. */
export const CARIES_CODES = ['D', 'd'] as const;

/** Fluoride varnish, as recorded on a tooth record's treatment_code. */
const FLUORIDE_CODE = 'FV';

export type Sex = 'Male' | 'Female';
export type BySex = Record<Sex, number>;

const zero = (): BySex => ({ Male: 0, Female: 0 });

export interface SchoolSummaryTally {
  /** Students in scope — the school's roster for the selected year. */
  students: BySex;
  /** Students with an ORAL_HEALTH_CONDITION record for the year. A row about
   *  a finding is only meaningful against those actually examined. */
  examined: BySex;
  /** Students carrying ≥1 tooth with the code. */
  personsByCode: Record<string, BySex>;
  /** Teeth carrying the code. */
  teethByCode: Record<string, BySex>;
  /** Students whose ORAL_HEALTH_CONDITION has the boolean set. */
  personsByCondition: Record<string, BySex>;
  /** Students with NO fluoride varnish recorded for the year. */
  noFluoride: BySex;
}

const emptyTally = (): SchoolSummaryTally => ({
  students: zero(),
  examined: zero(),
  personsByCode: {},
  teethByCode: {},
  personsByCondition: {},
  noFluoride: zero(),
});

/** "M"/"male"/"MALE" all appear in seeded and hand-entered data; anything else
 *  (blank, "Other") is counted in NEITHER column rather than guessed into one.
 *  The sheet has exactly two sex columns and no total, so a wrong guess would
 *  be invisible. */
function sexOf(raw: string | undefined): Sex | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'male' || s === 'm') return 'Male';
  if (s === 'female' || s === 'f') return 'Female';
  return null;
}

export function useSchoolSummary(schoolName: string | null, schoolYear: string | null) {
  const [tally, setTally] = useState<SchoolSummaryTally>(emptyTally);
  const [years, setYears] = useState<string[]>([]);
  const [unsexed, setUnsexed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Same guard as useDohReportData: a slow earlier run must not land on top of
  // a newer one and resurrect stale counts.
  const runIdRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isStale = () => runId !== runIdRef.current;
    setLoading(true);
    try {
      const [schools, students, iptrs, orals, charts, toothRecords] = await Promise.all([
        apiClient.get<ApiSchool[]>('/schools'),
        apiClient.get<ApiStudent[]>('/students'),
        apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
        apiClient.get<ApiOralHealthCondition[]>('/oral-health-conditions'),
        apiClient.get<ApiDentalChart[]>('/dental-charts'),
        apiClient.get<ApiToothRecord[]>('/tooth-records'),
      ]);
      if (isStale()) return;

      setYears([...new Set(iptrs.map((i) => i.school_year))].sort().reverse());

      // Scope on school_id, not the display name: students store the id.
      const schoolId = schoolName ? schools.find((s) => s.school_name === schoolName)?._id ?? null : null;
      const scopedStudents = schoolId ? students.filter((s) => s.school_id === schoolId) : students;

      const yearIptrs = schoolYear ? iptrs.filter((i) => i.school_year === schoolYear) : iptrs;
      const iptrIdsByStudent = new Map<string, string[]>();
      for (const i of yearIptrs) {
        const list = iptrIdsByStudent.get(i.student_id) ?? [];
        list.push(i._id);
        iptrIdsByStudent.set(i.student_id, list);
      }

      const oralByIptr = new Map<string, ApiOralHealthCondition>();
      for (const o of orals) oralByIptr.set(o.iptr_id, o);

      const chartIdsByIptr = new Map<string, string[]>();
      for (const c of charts) {
        const list = chartIdsByIptr.get(c.iptr_id) ?? [];
        list.push(c._id);
        chartIdsByIptr.set(c.iptr_id, list);
      }
      const toothByChart = new Map<string, ApiToothRecord[]>();
      for (const t of toothRecords) {
        const list = toothByChart.get(t.chart_id) ?? [];
        list.push(t);
        toothByChart.set(t.chart_id, list);
      }

      const next = emptyTally();
      const bump = (bag: Record<string, BySex>, key: string, sex: Sex, by = 1) => {
        const cell = bag[key] ?? zero();
        cell[sex] += by;
        bag[key] = cell;
      };
      let skipped = 0;

      for (const student of scopedStudents) {
        const sex = sexOf(student.sex);
        if (!sex) { skipped++; continue; }
        next.students[sex]++;

        const studentIptrs = iptrIdsByStudent.get(student._id) ?? [];
        if (studentIptrs.length === 0) {
          // No IPTR for the year: nothing was examined, so no fluoride either.
          // Counted in `students` but in no finding row — which is the truth.
          next.noFluoride[sex]++;
          continue;
        }

        let examined = false;
        let hasFluoride = false;
        const codeSeen = new Set<string>();
        const conditionSeen = new Set<string>();

        for (const iptrId of studentIptrs) {
          const oral = oralByIptr.get(iptrId);
          if (oral) {
            examined = true;
            if (oral.gingivitis) conditionSeen.add('gingivitis');
            if (oral.debris) conditionSeen.add('debris');
            if (oral.calculus) conditionSeen.add('calculus');
          }
          for (const chartId of chartIdsByIptr.get(iptrId) ?? []) {
            for (const tooth of toothByChart.get(chartId) ?? []) {
              if (tooth.treatment_code === FLUORIDE_CODE) hasFluoride = true;
              const code = tooth.condition;
              if (!code) continue;
              // Teeth are counted in full; the person is counted once, below.
              bump(next.teethByCode, code, sex);
              codeSeen.add(code);
            }
          }
        }

        if (examined) next.examined[sex]++;
        if (!hasFluoride) next.noFluoride[sex]++;
        for (const code of codeSeen) bump(next.personsByCode, code, sex);
        for (const condition of conditionSeen) bump(next.personsByCondition, condition, sex);
        // Caries is its own person row: a student with both a D and a d must
        // count ONCE here, which is why it is derived from the set rather than
        // by adding the two per-code person tallies.
        if (CARIES_CODES.some((c) => codeSeen.has(c))) bump(next.personsByCode, 'caries', sex);
      }

      // Teeth for the derived caries row — a plain sum is right here, because
      // a tooth is either D or d, never both.
      next.teethByCode.caries = {
        Male: CARIES_CODES.reduce((n, c) => n + (next.teethByCode[c]?.Male ?? 0), 0),
        Female: CARIES_CODES.reduce((n, c) => n + (next.teethByCode[c]?.Female ?? 0), 0),
      };

      if (isStale()) return;
      setTally(next);
      setUnsexed(skipped);
      setError(null);
    } catch (err) {
      if (isStale()) return;
      setError(err instanceof Error ? err.message : 'Could not load the school summary.');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [schoolName, schoolYear]);

  useEffect(() => { void load(); }, [load]);

  return {
    tally,
    /** School years present in the data, newest first. */
    years,
    /** Students whose sex is blank or unrecognised: counted in no column, and
     *  said out loud on screen rather than quietly folded into one. */
    unsexedCount: unsexed,
    loading,
    error,
    reload: load,
  };
}
