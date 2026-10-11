// ─── DOH report aggregation, shared by the server and the client ───────────
//
// Sprint 138. This logic used to live in `useDohReportData` and run in the
// BROWSER, which is why the browser had to download eleven whole collections
// to draw one report: measured 2026-09-05 at ~108 KB for 26 pupils, i.e.
// ~4.1 KB per pupil per page open — about 32 MB at the Chapter 1 scale of
// 8,000 pupils, and 60-80 MB once mouths are charted at a realistic 20-32
// teeth rather than the demo's ~5.
//
// It is MOVED here, not copied. Two implementations of a DOH return would
// drift, and the drift would show up as two different numbers on a document
// filed with the City Health Office.
//
// `shared/` is the project's cross-boundary module (Sprint 120/121, already in
// both tsconfigs). Nothing here may import mongoose or React: the server calls
// it with lean documents, and the types below are the intersection both sides
// agree on.

export interface AggStudent {
  _id: string;
  school_id: string;
  sex: string;
  birthday: string;
}
export interface AggIptr {
  _id: string;
  student_id: string;
  school_year: string;
  grade_level?: string | null;
}
export interface AggMedical {
  iptr_id: string;
  allergies?: string;
  hypertension?: boolean;
  diabetes_mellitus?: boolean;
  cardiovascular_disease?: boolean;
  thyroid_disorders?: boolean;
  hepatitis_disorders?: boolean;
  malignancy?: boolean;
  previous_hospitalization?: boolean;
  blood_transfusion?: boolean;
  tattoo?: boolean;
}
export interface AggDietary {
  iptr_id: string;
  sugar_beverages?: boolean;
  alcohol_drinker?: boolean;
  tobacco_user?: boolean;
  betel_nut_chewer?: boolean;
}
export interface AggOral {
  iptr_id: string;
  gingivitis?: boolean;
  debris?: boolean;
  calculus?: boolean;
  abnormal_growth?: boolean;
  periodontal_disease?: boolean;
}
export interface AggPreventive {
  _id: string;
  iptr_id: string;
  visit_number?: number;
  visit_date?: string | null;
  facility_based?: boolean | null;
}
export interface AggRisk {
  preventive_id: string;
  dmf_score: number;
  dmf_index: string;
  risk_level: string;
}
export interface AggChart {
  _id: string;
  iptr_id: string;
  date_charted: string;
  /** The RPC visit this charting was done at, 1 or 2 (Sprint 150), or null for
   *  a charting attached to no visit — every chart made before Sprint 149, and
   *  any made from the chart screen rather than from Record Visit. */
  visit_number?: 1 | 2 | null;
}
export interface AggTooth {
  chart_id: string;
  treatment_code?: string | null;
}
export interface AggReferral {
  iptr_id: string;
  referral_type: string;
}
export interface AggSchool {
  _id: string;
  school_name: string;
}

export interface DohAggregateInput {
  schools: AggSchool[];
  students: AggStudent[];
  iptrs: AggIptr[];
  medicals: AggMedical[];
  dietaries: AggDietary[];
  orals: AggOral[];
  preventives: AggPreventive[];
  risks: AggRisk[];
  charts: AggChart[];
  toothRecords: AggTooth[];
  referrals: AggReferral[];
  /** "YYYY-YYYY", or null for every record ever. */
  schoolYear: string | null;
  /** School NAME as the dropdown carries it, or null for all schools. */
  schoolName: string | null;
}

export interface DohAggregateResult {
  /** `${grade}|${ageBand}|${sex}|${field}` → count. */
  counts: Record<string, number>;
  /** Every school year present in the data, newest first. */
  years: string[];
  /** Records whose grade predates Sprint 57a. */
  unplaced: number;
}

/** Services the form reports as 1st / 2nd application.
 *
 *  ⚠ THE ORDINAL IS DERIVED FROM CHART DATES. Nothing records "this was the
 *  2nd application": within ONE school year's IPTR the charts are ordered by
 *  `date_charted` and the first chart carrying the code is the 1st application.
 *  Counting occurrences WITHIN a chart would be wrong — several teeth varnished
 *  in one sitting is one application, not five. */
export const ORDINAL_TREATMENTS: Record<string, string> = {
  OP: 'op_scaling',
  FV: 'fv',
  SDF: 'sdf',
};

/** Services the form reports as Head Count / Tooth Count.
 *
 *  ⚠ `TR` for ART is the mapping the TARGET CLIENT LIST already uses. Following
 *  it keeps the two DOH returns consistent; inventing a second answer here
 *  would make two filed forms disagree about the same treatments. */
export const HEAD_TOOTH_TREATMENTS: Record<string, string> = {
  TR: 'art',
  PFS: 'sealant',
  X: 'extraction',
};

export const REAL_MEDICAL_FIELDS: Record<string, keyof AggMedical> = {
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

export const REAL_DIETARY_FIELDS: Record<string, keyof AggDietary> = {
  sugarSweetened: 'sugar_beverages',
  alcoholDrinker: 'alcohol_drinker',
  tobaccoUser: 'tobacco_user',
  betelNut: 'betel_nut_chewer',
};

export const REAL_ORAL_FIELDS: Record<string, keyof AggOral> = {
  gingivitis: 'gingivitis',
  debris: 'debris',
  calculus: 'calculus',
  anomaly: 'abnormal_growth',
  periodontitis: 'periodontal_disease',
};

/** Grade bucket for records whose year predates Sprint 57a. They are still
 *  counted — dropping a real pupil from a DOH total would be worse than not
 *  knowing their grade — but they cannot be placed in a grade row. */
export const GRADE_NOT_RECORDED = '__not_recorded__';

/** Key holding the across-all-grades total for an age band + sex + field. */
export const GRADE_ALL = '__all__';

/** Whole years completed between two dates. The month/day comparison is not a
 *  nicety: `yearA - yearB` alone reports a child born in December 2015 as 11
 *  during 2026 when they are still 10, so roughly a twelfth of pupils landed
 *  one age bracket too high on a form submitted to the City Health Office. */
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
 *  against when no examination date is recorded. Deterministic on purpose: a
 *  submitted report re-opened next month must produce the same numbers it did
 *  when it was filed, which an age computed to "today" cannot. */
function schoolYearStartDate(schoolYear: string): Date | null {
  const first = Number(String(schoolYear).split('-')[0]);
  return Number.isFinite(first) ? new Date(first, 5, 1) : null;
}

/** Per-IPTR service tallies: teeth treated per code, and WHICH VISIT each code
 *  was done at.
 *
 *  ⚠ SPRINT 150 CHANGED WHERE THE ORDINAL COMES FROM. It used to be inferred:
 *  the charts were ordered by `date_charted` and the first chart carrying a
 *  code was called the 1st application, the second the 2nd. That was an
 *  interpretation — this file said so — because nothing recorded which visit a
 *  charting belonged to. Sprint 149 gave DENTAL_CHART a `preventive_id`, so a
 *  linked charting now STATES its visit and the ordinal is a lookup.
 *
 *  ⚠ THE OLD RULE REMAINS THE FALLBACK, and has to: every charting made before
 *  Sprint 149 is unlinked, and ignoring them would erase services from returns
 *  already filed. Unlinked chartings fill the visit slots no linked charting
 *  claims, oldest first — so a database with no links produces exactly the
 *  numbers it produced before.
 *
 *  Counting occurrences WITHIN one charting would be wrong either way: several
 *  teeth varnished in one sitting is one application, not five. */
export function tallyIptrServices(
  charts: AggChart[],
  toothByChart: Map<string, AggTooth[]>,
): { teethByCode: Record<string, number>; codesByVisit: Record<1 | 2, Set<string>> } {
  const teethByCode: Record<string, number> = {};
  const codesByVisit: Record<1 | 2, Set<string>> = { 1: new Set(), 2: new Set() };

  const ordered = charts
    .slice()
    .sort((a, b) => new Date(a.date_charted).getTime() - new Date(b.date_charted).getTime());

  // Teeth are counted for EVERY charting, linked or not — a tooth count is not
  // an ordinal and never depended on this.
  const codesOf = (chart: AggChart) => {
    const codes = new Set<string>();
    for (const tooth of toothByChart.get(chart._id) ?? []) {
      const code = tooth.treatment_code;
      if (!code) continue;
      teethByCode[code] = (teethByCode[code] ?? 0) + 1;
      codes.add(code);
    }
    return codes;
  };

  // ⚠ LINKED AND UNLINKED CHARTINGS ARE COUNTED BY DIFFERENT RULES, ON PURPOSE.
  //
  // A linked charting STATES its visit, so its codes go to that visit and no
  // date order can override them.
  //
  // Unlinked chartings keep the PRE-SPRINT-150 rule exactly: per CODE, how many
  // sittings carried it — one sitting means a 1st application, two or more
  // means a 2nd as well. That is per code, not per chart, which matters: a code
  // appearing only in a pupil's THIRD charting still counted as a 1st
  // application under the old rule, and a "fill the first two slots" rule
  // silently dropped it. Caught by diffing the filed numbers before and after —
  // sdf_1st fell 9 → 7 and sdf_2nd rose 0 → 2 on the first attempt.
  //
  // A linked charting is excluded from the sittings tally so its codes are
  // never counted twice. With nothing linked — which is all real data today —
  // this reproduces the old numbers exactly.
  const linked: { visit: 1 | 2; codes: Set<string> }[] = [];
  const unlinkedSittings: Record<string, number> = {};
  for (const chart of ordered) {
    const codes = codesOf(chart);
    if (chart.visit_number === 1 || chart.visit_number === 2) {
      linked.push({ visit: chart.visit_number, codes });
    } else {
      for (const code of codes) unlinkedSittings[code] = (unlinkedSittings[code] ?? 0) + 1;
    }
  }

  for (const [code, sittings] of Object.entries(unlinkedSittings)) {
    if (sittings >= 1) codesByVisit[1].add(code);
    if (sittings >= 2) codesByVisit[2].add(code);
  }
  for (const { visit, codes } of linked) {
    for (const code of codes) codesByVisit[visit].add(code);
  }

  return { teethByCode, codesByVisit };
}

export function aggregateDohReport(input: DohAggregateInput): DohAggregateResult {
  const {
    schools, students, iptrs, medicals, dietaries, orals,
    preventives, risks, charts, toothRecords, referrals,
    schoolYear, schoolName,
  } = input;

  // Scope to one school. Matched on school_id rather than the display name:
  // the name is what the dropdown carries, but students store the id.
  const schoolId = schoolName ? schools.find((s) => s.school_name === schoolName)?._id ?? null : null;
  const scopedStudents = schoolId ? students.filter((s) => s.school_id === schoolId) : students;

  const years = [...new Set(iptrs.map((i) => i.school_year))].sort().reverse();
  const scoped = schoolYear ? iptrs.filter((i) => i.school_year === schoolYear) : iptrs;

  // Earliest recorded visit per IPTR — the closest thing to an examination
  // date the data model holds.
  const firstVisitByIptr = new Map<string, Date>();
  for (const p of preventives) {
    if (!p.visit_date) continue;
    const d = new Date(p.visit_date);
    if (Number.isNaN(d.getTime())) continue;
    const seen = firstVisitByIptr.get(p.iptr_id);
    if (!seen || d < seen) firstVisitByIptr.set(p.iptr_id, d);
  }

  // Per-IPTR visit facts. `firstFacility` is the flag on the EARLIEST visit,
  // which is the one "visited for the 1st time" asks about.
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
  const riskByIptr = new Map<string, AggRisk>();
  for (const r of risks) {
    const p = preventiveById.get(r.preventive_id);
    if (p) riskByIptr.set(p.iptr_id, r);
  }

  const chartsByIptr = new Map<string, AggChart[]>();
  for (const c of charts) {
    const list = chartsByIptr.get(c.iptr_id) ?? [];
    list.push(c);
    chartsByIptr.set(c.iptr_id, list);
  }
  const toothByChart = new Map<string, AggTooth[]>();
  for (const t of toothRecords) {
    const list = toothByChart.get(t.chart_id) ?? [];
    list.push(t);
    toothByChart.set(t.chart_id, list);
  }
  const referralsByIptr = new Map<string, AggReferral[]>();
  for (const r of referrals) {
    const list = referralsByIptr.get(r.iptr_id) ?? [];
    list.push(r);
    referralsByIptr.set(r.iptr_id, list);
  }

  const result: Record<string, number> = {};
  const increment = (key: string, by = 1) => { result[key] = (result[key] ?? 0) + by; };

  // One pass per IPTR, not per student. Grade and age belong to the school
  // year's record, so a pupil with two years contributes each year under that
  // year's own grade and that year's own age.
  let unplaced = 0;
  for (const s of scopedStudents) {
    const sex: 'M' | 'F' = String(s.sex ?? '').startsWith('M') ? 'M' : 'F';
    for (const iptrId of iptrsByStudent.get(s._id) ?? []) {
      const ctx = ctxByIptr.get(iptrId);
      if (!ctx) continue;
      const grade = ctx.grade;
      if (grade === GRADE_NOT_RECORDED) unplaced++;
      const age = bracketOf(ctx.asOf ? ageAt(s.birthday, ctx.asOf) : null);

      // Counted under its own grade AND under an all-grades key, so a record
      // whose grade predates Sprint 57a still counts toward a submitted total.
      const bump = (field: string, by = 1) => {
        increment(`${grade}|${age}|${sex}|${field}`, by);
        increment(`${GRADE_ALL}|${age}|${sex}|${field}`, by);
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
        // The paper form has ONE row, "Oral Debris / Calculus Deposits", where
        // this system stores two booleans. It must be counted as EITHER —
        // adding the two counts would double-count anyone with both.
        if (oral.debris === true || oral.calculus === true) bump('debris_or_calculus');
      }

      const visits = visitsByIptr.get(iptrId);
      if (visits) {
        if (visits.hasVisit1) bump('rpoc_visit1');
        if (visits.hasVisit2) bump('rpoc_visit2');
        if (visits.firstFacility === true) bump('visit_facility_1st');
        if (visits.firstFacility === false) bump('visit_nonfacility_1st');
      }

      const { teethByCode, codesByVisit } = tallyIptrServices(chartsByIptr.get(iptrId) ?? [], toothByChart);
      for (const [code, field] of Object.entries(ORDINAL_TREATMENTS)) {
        // A patient counts in BOTH rows when they had the service at both
        // visits — the form asks how many received a 1st and how many received
        // a 2nd, not which was their last.
        if (codesByVisit[1].has(code)) bump(`${field}_1st`);
        if (codesByVisit[2].has(code)) bump(`${field}_2nd`);
      }
      for (const [code, field] of Object.entries(HEAD_TOOTH_TREATMENTS)) {
        const teeth = teethByCode[code] ?? 0;
        if (teeth > 0) {
          bump(`${field}_head`);
          bump(`${field}_tooth`, teeth);
        }
      }

      // ⚠ Referral rows count PATIENTS, not slips, and a/b/c print INDENTED
      // under the Higher Level total, so that total is `higher_level` PLUS the
      // three sub-kinds. Recording a surgical referral as `higher_level` too
      // would double-count the pupil.
      const iptrReferrals = referralsByIptr.get(iptrId) ?? [];
      if (iptrReferrals.length > 0) {
        const types = new Set(iptrReferrals.map((r) => r.referral_type));
        if (types.has('primary_care')) bump('ref_primary');
        if (types.has('oral_cancer_screening')) bump('ref_cancer');
        if (types.has('surgical')) bump('ref_surgical');
        if (types.has('private_facility')) bump('ref_private');
        if (
          types.has('higher_level') ||
          types.has('oral_cancer_screening') ||
          types.has('surgical') ||
          types.has('private_facility')
        ) {
          bump('ref_higher');
        }
      }

      if (risk && risk.dmf_score > 0) bump(risk.dmf_index === 'DMF' ? 'DMF_total' : 'dmf_df');
      if (risk && risk.risk_level === 'Low') bump('ofc_exam');
    }
  }

  return { counts: result, years, unplaced };
}
