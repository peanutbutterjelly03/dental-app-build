import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useLoadPhase } from './useLoadPhase';
import type {
  ApiSchool,
  ApiStudent,
  ApiStudentIptr,
  ApiMedicalHistory,
  ApiDietarySocialHabits,
  ApiOralHealthCondition,
  ApiPreventiveCareRecord,
  ApiRiskStratification,
  ApiDentalChart,
  ApiToothRecord,
} from '../api/types';

// ─── Section C — Services Rendered (Sprint 90) ───────────────────────────────
// Until now every Services Rendered row was `field: null` and the whole section
// printed dashes. The source was there the whole time: TOOTH_RECORD carries a
// `treatment_code`, and DENTAL_CHART hangs off `iptr_id`, so a service can be
// attributed to the right school year, age band and sex without a schema
// change.
//
// ⚠ `treatment_code`, NEVER `condition`. `X` means Extraction as a TREATMENT
// and "indicated for extraction" as a CONDITION (see the durable gotcha about
// X/x). Reading the wrong column here would report every tooth flagged for
// extraction as one already pulled.

/** Services the form reports as 1st / 2nd application.
 *
 *  ⚠ THE ORDINAL IS DERIVED FROM CHART DATES, and that is an interpretation
 *  worth understanding. Nothing records "this was the 2nd application":
 *  PREVENTIVE_CARE_RECORD stores no services at all. So within ONE school
 *  year's IPTR, the student's charts are ordered by `date_charted` and the
 *  first chart carrying the code is the 1st application, the second is the
 *  2nd. Counting occurrences WITHIN a chart would be wrong — several teeth
 *  varnished in one sitting is one application, not five. */
const ORDINAL_TREATMENTS: Record<string, string> = {
  OP: 'op_scaling',
  FV: 'fv',
  SDF: 'sdf',
};

/** Services the form reports as Head Count / Tooth Count.
 *
 *  ⚠ `TR` for ART is the mapping the TARGET CLIENT LIST already uses
 *  (`TargetClientList.tsx:276`, "ART/Glass Ionomer Filling"). Following it
 *  keeps the two DOH returns consistent; inventing a second answer here would
 *  make two filed forms disagree about the same treatments. */
const HEAD_TOOTH_TREATMENTS: Record<string, string> = {
  TR: 'art',
  PFS: 'sealant',
  X: 'extraction',
};

/** Per-IPTR service tallies: teeth treated per code, and how many SITTINGS
 *  (charts) carried each code.
 *
 *  Exported and pure so it can be tested against controlled input. That is not
 *  a nicety here: **no tooth record in the demo database carries a
 *  `treatment_code` at all** (verified 2026-09-03 — all 27 have only a
 *  `condition`), so every Services Rendered figure is legitimately 0 and the
 *  live data cannot demonstrate that the arithmetic is right. The distinction
 *  this function exists to get right — four sealants in one visit is ONE
 *  patient, FOUR teeth and ONE application — is exactly what a screen full of
 *  zeros cannot show. */
export function tallyIptrServices(
  charts: ApiDentalChart[],
  toothByChart: Map<string, ApiToothRecord[]>,
): { teethByCode: Record<string, number>; sittingsByCode: Record<string, number> } {
  const teethByCode: Record<string, number> = {};
  const sittingsByCode: Record<string, number> = {};
  const ordered = charts
    .slice()
    .sort((a, b) => new Date(a.date_charted).getTime() - new Date(b.date_charted).getTime());
  for (const chart of ordered) {
    const inThisChart = new Set<string>();
    for (const tooth of toothByChart.get(chart._id) ?? []) {
      const code = tooth.treatment_code;
      if (!code) continue;
      teethByCode[code] = (teethByCode[code] ?? 0) + 1;
      inThisChart.add(code);
    }
    for (const code of inThisChart) sittingsByCode[code] = (sittingsByCode[code] ?? 0) + 1;
  }
  return { teethByCode, sittingsByCode };
}

// Fields with a direct, defensible mapping to real seeded data. Everything
// else in the DOH table (Services Rendered, and a handful of oral-health/DMF
// rows with no matching schema field) resolves to 0 in Reports.tsx — never a
// fabricated fallback number. An earlier version of this comment said those
// rows fell back to an "illustrative sparse table"; that has not been true
// since the fallback was removed, and the stale wording is misleading in a
// report that gets submitted to the City Health Office.
const REAL_MEDICAL_FIELDS: Record<string, keyof ApiMedicalHistory> = {
  allergies: 'allergies',
  hypertension: 'hypertension',
  diabetes: 'diabetes_mellitus',
  cardiovascular: 'cardiovascular_disease',
  thyroid: 'thyroid_disorders',
  hepatitis: 'hepatitis_disorders',
  malignancy: 'malignancy',
  hospitalization: 'previous_hospitalization',
  bloodTransfusion: 'blood_transfusion',
  tattoo: 'tattoo',
};

const REAL_DIETARY_FIELDS: Record<string, keyof ApiDietarySocialHabits> = {
  sugarSweetened: 'sugar_beverages',
  alcoholDrinker: 'alcohol_drinker',
  tobaccoUser: 'tobacco_user',
  betelNut: 'betel_nut_chewer',
};

const REAL_ORAL_FIELDS: Record<string, keyof ApiOralHealthCondition> = {
  gingivitis: 'gingivitis',
  debris: 'debris',
  calculus: 'calculus',
  anomaly: 'abnormal_growth',
  // Sprint 83: the paper form has a Periodontitis row and ORAL_HEALTH_CONDITION
  // has carried `periodontal_disease` all along — it was simply never mapped,
  // so the row could not be built and the figure was unavailable.
  periodontitis: 'periodontal_disease',
};

/** Whole years completed between two dates. The month/day comparison is not a
 *  nicety: `yearA - yearB` alone reports a child born in December 2015 as 11
 *  during 2026 when they are still 10, so roughly a twelfth of pupils landed
 *  one age bracket too high on a form submitted to the City Health Office.
 *  TargetClientList already adjusted; this file did not, so the two DOH
 *  outputs could disagree with each other. */
export function ageAt(birthdate: string | Date, on: Date): number | null {
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

function bracketOf(age: number | null): string {
  if (age === null) return 'unknown';
  if (age <= 4) return '4 yrs & below';
  if (age <= 9) return '5-9 yrs';
  if (age <= 14) return '10-14 yrs';
  if (age <= 19) return '15-19 yrs';
  return '20 yrs & above';
}

/** June 1 of a "YYYY-YYYY" school year — the anchor a pupil's age is reported
 *  against when no examination date is recorded for that year. Deterministic
 *  on purpose: a submitted report re-opened next month must produce the same
 *  numbers it did when it was filed, which an age computed to "today" cannot. */
function schoolYearStartDate(schoolYear: string): Date | null {
  const first = Number(String(schoolYear).split('-')[0]);
  return Number.isFinite(first) ? new Date(first, 5, 1) : null;
}

/** Grade bucket for records whose year predates Sprint 57a, when STUDENT_IPTR
 *  did not carry a grade. They are still counted — dropping a real pupil from a
 *  DOH total would be worse than not knowing their grade — but they cannot be
 *  placed in a grade row, so the UI discloses how many there are. */
export const GRADE_NOT_RECORDED = '__not_recorded__';

/** Key holding the across-all-grades total for an age band + sex + field. */
export const GRADE_ALL = '__all__';

// A DOH report is submitted to the City Health Office, so a stale number is
// worse than a slow one. Refreshing when the tab is refocused costs one fetch
// round and keeps the table honest without the user thinking about it.
// Throttled so alt-tabbing doesn't re-run seven collection reads repeatedly.
const REFRESH_THROTTLE_MS = 30 * 1000;

/** @param schoolYear "YYYY-YYYY" to scope the report to one school year, or
 *  null for every record ever. A DOH report covers a period — this year's
 *  report is not next year's — so callers should pass a year; null exists for
 *  the "all records to date" view this hook used to be hard-wired to.
 *  @param schoolName the school to report on, or null for all schools.
 *
 *  ⚠ The school parameter was MISSING until 2026-09-02, and the Reports tab
 *  had a School dropdown the whole time. It changed the printed header, the
 *  export filename and the export metadata — and nothing else. Selecting one
 *  school produced a document TITLED that school containing all three schools'
 *  figures, which over-reports two of them and misattributes the third, on a
 *  report submitted to the City Health Office. A control that appears to filter
 *  must filter (see CLAUDE.md "NOTHING COSMETIC"). */
export function useDohReportData(schoolYear: string | null = null, schoolName: string | null = null) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [years, setYears] = useState<string[]>([]);
  const [unplaced, setUnplaced] = useState(0);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  // Guards against two hazards at once: writing state after unmount, and a
  // slow earlier refresh landing on top of a newer one and resurrecting old
  // counts. Only the most recently started run may commit.
  const runIdRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isStale = () => runId !== runIdRef.current;
    beginLoad();

    try {
      // ⚠ Two more whole-collection reads (charts + tooth records), on a hook
      // already listed under the unbounded-reads work (Open work 0b / 24).
      // Accepted deliberately: without them Services Rendered cannot be filled
      // at all, and the same two collections are already fetched this way by
      // useRPCTracking. It makes the pagination work more urgent, not less.
      const [schools, students, iptrs, medicals, dietaries, orals, preventives, risks, charts, toothRecords] = await Promise.all([
        apiClient.get<ApiSchool[]>('/schools'),
        apiClient.get<ApiStudent[]>('/students'),
        apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
        apiClient.get<ApiMedicalHistory[]>('/medical-histories'),
        apiClient.get<ApiDietarySocialHabits[]>('/dietary-social-habits'),
        apiClient.get<ApiOralHealthCondition[]>('/oral-health-conditions'),
        apiClient.get<ApiPreventiveCareRecord[]>('/preventive-care-records'),
        apiClient.get<ApiRiskStratification[]>('/risk-stratifications'),
        apiClient.get<ApiDentalChart[]>('/dental-charts'),
        apiClient.get<ApiToothRecord[]>('/tooth-records'),
      ]);

      // Scope to one school. Matched on school_id rather than the display name:
      // the name is what the dropdown carries, but students store the id.
      const schoolId = schoolName ? schools.find((s) => s.school_name === schoolName)?._id ?? null : null;
      const scopedStudents = schoolId ? students.filter((s) => s.school_id === schoolId) : students;

      // Every school year present, newest first — drives the year picker.
      const allYears = [...new Set(iptrs.map((i) => i.school_year))].sort().reverse();

      // Scope to the requested school year. This is the substance of Sprint
      // 57b: the report used to count every record ever created, so it could
      // not answer "what did we do this year?" at all.
      const scoped = schoolYear ? iptrs.filter((i) => i.school_year === schoolYear) : iptrs;

      // Earliest recorded visit per IPTR — the closest thing to an examination
      // date the data model holds. PREVENTIVE_CARE_RECORD is already fetched
      // below for the risk join, so this costs no extra round trip.
      const firstVisitByIptr = new Map<string, Date>();
      for (const p of preventives) {
        if (!p.visit_date) continue;
        const d = new Date(p.visit_date);
        if (Number.isNaN(d.getTime())) continue;
        const seen = firstVisitByIptr.get(p.iptr_id);
        if (!seen || d < seen) firstVisitByIptr.set(p.iptr_id, d);
      }

      // Per-IPTR visit facts for the form's Patient Seeking Utilization rows.
      // `firstFacility` is the flag on the EARLIEST visit, which is the one
      // "visited for the 1st time" asks about.
      const visitsByIptr = new Map<string, { hasVisit1: boolean; hasVisit2: boolean; firstFacility: boolean | null }>();
      for (const p of preventives) {
        const v = visitsByIptr.get(p.iptr_id) ?? { hasVisit1: false, hasVisit2: false, firstFacility: null };
        if (p.visit_number === 1) v.hasVisit1 = true;
        if (p.visit_number === 2) v.hasVisit2 = true;
        const first = firstVisitByIptr.get(p.iptr_id);
        const d = p.visit_date ? new Date(p.visit_date) : null;
        if (first && d && !Number.isNaN(d.getTime()) && d.getTime() === first.getTime()) {
          v.firstFacility = p.facility_based ?? null;
        }
        visitsByIptr.set(p.iptr_id, v);
      }

      const iptrsByStudent = new Map<string, string[]>();
      // Grade and age basis are per-IPTR now, not per-student: the grade is the
      // one recorded FOR THAT YEAR (Sprint 57a) and the age is measured at that
      // year's examination, so a past report stops being recomputed against
      // today's grades and today's ages.
      const ctxByIptr = new Map<string, { grade: string; asOf: Date | null }>();
      for (const i of scoped) {
        const list = iptrsByStudent.get(i.student_id) ?? [];
        list.push(i._id);
        iptrsByStudent.set(i.student_id, list);
        ctxByIptr.set(i._id, {
          grade: i.grade_level ?? GRADE_NOT_RECORDED,
          asOf: firstVisitByIptr.get(i._id) ?? schoolYearStartDate(i.school_year),
        });
      }
      const medicalByIptr = new Map(medicals.map((m) => [m.iptr_id, m]));
      const dietaryByIptr = new Map(dietaries.map((d) => [d.iptr_id, d]));
      const oralByIptr = new Map(orals.map((o) => [o.iptr_id, o]));
      const preventiveById = new Map(preventives.map((p) => [p._id, p]));
      const riskByIptr = new Map<string, ApiRiskStratification>();
      for (const r of risks) {
        const p = preventiveById.get(r.preventive_id);
        if (p) riskByIptr.set(p.iptr_id, r);
      }

      // Charts belong to an IPTR, so a service lands in the right school year
      // by construction — the same join Sprint 88's summary sheet uses.
      const chartsByIptr = new Map<string, ApiDentalChart[]>();
      for (const c of charts) {
        const list = chartsByIptr.get(c.iptr_id) ?? [];
        list.push(c);
        chartsByIptr.set(c.iptr_id, list);
      }
      const toothByChart = new Map<string, ApiToothRecord[]>();
      for (const t of toothRecords) {
        const list = toothByChart.get(t.chart_id) ?? [];
        list.push(t);
        toothByChart.set(t.chart_id, list);
      }

      const increment = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
      const result = new Map<string, number>();

      // One pass per IPTR, not per student. Grade and age now belong to the
      // school year's record, so a student with two years contributes each year
      // under that year's own grade and that year's own age.
      let unplacedCount = 0;
      for (const s of scopedStudents) {
        const sex: 'M' | 'F' = s.sex.startsWith('M') ? 'M' : 'F';
        for (const iptrId of iptrsByStudent.get(s._id) ?? []) {
          const ctx = ctxByIptr.get(iptrId);
          if (!ctx) continue;
          const grade = ctx.grade;
          if (grade === GRADE_NOT_RECORDED) unplacedCount++;
          const age = bracketOf(ctx.asOf ? ageAt(s.birthday, ctx.asOf) : null);

          // Counted under its own grade AND under an all-grades key. Forms that
          // total across grades (the OHPRF) read the latter, so a record whose
          // grade predates Sprint 57a still counts toward the total instead of
          // silently vanishing from a submitted figure.
          const bump = (field: string, by = 1) => {
            increment(result, `${grade}|${age}|${sex}|${field}`, by);
            increment(result, `${GRADE_ALL}|${age}|${sex}|${field}`, by);
          };

          const medical = medicalByIptr.get(iptrId);
          const dietary = dietaryByIptr.get(iptrId);
          const oral = oralByIptr.get(iptrId);
          const risk = riskByIptr.get(iptrId);

          if (oral) {
            bump('attended');
            bump('examined');
          }

          if (medical) {
            for (const [dohField, apiField] of Object.entries(REAL_MEDICAL_FIELDS)) {
              const value = medical[apiField];
              const isTrue = apiField === 'allergies' ? !!value : value === true;
              if (isTrue) bump(dohField);
            }
          }

          if (dietary) {
            for (const [dohField, apiField] of Object.entries(REAL_DIETARY_FIELDS)) {
              if (dietary[apiField] === true) bump(dohField);
            }
          }

          if (oral) {
            for (const [dohField, apiField] of Object.entries(REAL_ORAL_FIELDS)) {
              if (oral[apiField] === true) bump(dohField);
            }
            // The paper form has ONE row, "Oral Debris / Calculus Deposits",
            // where this system stores two booleans. It must be counted as
            // EITHER, computed here — adding the two separate counts would
            // double-count every patient who has both.
            if (oral.debris === true || oral.calculus === true) bump('debris_or_calculus');
          }

          // ── Section A, Patient Seeking Utilization (Sprint 83) ───────────
          // Counted per IPTR from PREVENTIVE_CARE_RECORD. The facility split
          // reads Sprint 81's flag on the FIRST visit; a null flag counts
          // toward neither row, exactly as on FHSIS — the form's two rows are
          // "facility" and "non-facility", and "not recorded" is neither.
          const visits = visitsByIptr.get(iptrId);
          if (visits) {
            if (visits.hasVisit1) bump('rpoc_visit1');
            if (visits.hasVisit2) bump('rpoc_visit2');
            if (visits.firstFacility === true) bump('visit_facility_1st');
            if (visits.firstFacility === false) bump('visit_nonfacility_1st');
          }

          // ── Section C, Services Rendered (Sprint 90) ─────────────────────
          // Two different shapes from one walk of this IPTR's charts:
          //   · teeth — every tooth record carrying the code
          //   · sittings — how many CHARTS carried it at all, which is what
          //     "1st / 2nd application" means. Five teeth varnished in one
          //     visit is one application.
          const { teethByCode, sittingsByCode } =
            tallyIptrServices(chartsByIptr.get(iptrId) ?? [], toothByChart);
          for (const [code, field] of Object.entries(ORDINAL_TREATMENTS)) {
            const sittings = sittingsByCode[code] ?? 0;
            // A patient counts in BOTH rows when they had two applications —
            // the form asks how many patients received a 1st and how many
            // received a 2nd, not which was their last.
            if (sittings >= 1) bump(`${field}_1st`);
            if (sittings >= 2) bump(`${field}_2nd`);
          }
          for (const [code, field] of Object.entries(HEAD_TOOTH_TREATMENTS)) {
            const teeth = teethByCode[code] ?? 0;
            if (teeth > 0) {
              bump(`${field}_head`);      // one patient
              bump(`${field}_tooth`, teeth); // however many teeth
            }
          }

          // DMF/dmf and OFC come from RiskStratification rather than a per-field
          // boolean, but belong to the same IPTR and so the same grade and age.
          if (risk && risk.dmf_score > 0) bump(risk.dmf_index === 'DMF' ? 'DMF_total' : 'dmf_df');
          if (risk && risk.risk_level === 'Low') bump('ofc_exam');
        }
      }

      if (!isStale()) {
        setCounts(result);
        setYears(allYears);
        setUnplaced(unplacedCount);
        // Clear a previous failure: a refresh that succeeds must not leave
        // the old error banner sitting above correct numbers.
        setError(null);
      }
    } catch (err) {
      if (!isStale()) setError(err instanceof Error ? err.message : 'Failed to load DOH report data');
    } finally {
      if (!isStale()) endLoad();
    }
  }, [beginLoad, endLoad, schoolYear, schoolName]);

  useEffect(() => {
    void load();
    // Bump the run id on unmount so an in-flight fetch can never commit.
    return () => { runIdRef.current++; };
  }, [load]);

  // Refresh when the user comes back to the tab. Mirrors UpdateToast's
  // approach (Sprint 42): an interval is the wrong shape here — what matters
  // is that the numbers are current at the moment someone looks at them.
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh < REFRESH_THROTTLE_MS) return;
      lastRefresh = Date.now();
      void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [load]);

  const REAL_FIELDS = new Set([
    'attended',
    'examined',
    ...Object.keys(REAL_MEDICAL_FIELDS),
    ...Object.keys(REAL_DIETARY_FIELDS),
    ...Object.keys(REAL_ORAL_FIELDS),
    'DMF_total',
    'dmf_df',
    'ofc_exam',
    // Sprint 83 — the form's Patient Seeking Utilization section, plus the
    // combined debris/calculus row the paper form actually prints.
    'debris_or_calculus',
    'rpoc_visit1',
    'rpoc_visit2',
    'visit_facility_1st',
    'visit_nonfacility_1st',
    // Sprint 90 — Services Rendered, from TOOTH_RECORD.treatment_code.
    // ⚠ This allowlist is what keeps "no source" honest: a field NOT named
    // here returns null and the form prints "—". So the rows still absent
    // below are absent ON PURPOSE — Oral Health Counselling and Root Surface
    // Protection have no treatment code in the system, and inventing a
    // mapping for them would put a fabricated number on a filed return.
    ...Object.values(ORDINAL_TREATMENTS).flatMap((f) => [`${f}_1st`, `${f}_2nd`]),
    ...Object.values(HEAD_TOOTH_TREATMENTS).flatMap((f) => [`${f}_head`, `${f}_tooth`]),
  ]);

  function getRealCount(grade: string, age: string, sex: 'M' | 'F', field: string): number | null {
    if (!REAL_FIELDS.has(field)) return null;
    return counts.get(`${grade}|${age}|${sex}|${field}`) ?? 0;
  }

  /** Total across every grade, including records whose grade was never
   *  recorded. Forms that report by age band only (the OHPRF) must use this
   *  rather than summing getRealCount over a grade list, which would drop
   *  pre-Sprint-57a records from the figure. */
  function getRealTotal(age: string, sex: 'M' | 'F', field: string): number | null {
    return getRealCount(GRADE_ALL, age, sex, field);
  }

  return {
    getRealCount,
    getRealTotal,
    /** School years present in the data, newest first — for the year picker. */
    years,
    /** Scoped records that carry no grade, so cannot appear in a grade row. */
    unplacedCount: unplaced,
    loading,
    error,
    reload: load,
  };
}
