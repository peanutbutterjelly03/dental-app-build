// ─── Per-school summary sheet, shared by the server and the client ─────────
//
// Sprint 141. This tally used to run in the BROWSER, so the sheet pulled SIX
// whole collections — students, IPTRs, oral-health conditions, dental charts,
// tooth records and schools — to draw thirteen rows of counts.
//
// Like `dohAggregate`, the OUTPUT IS COUNTS, so the response is flat: it does
// not grow with the roll. MOVED, not copied — the MALE/FEMALE-counts-students
// vs TOTAL-counts-teeth rule is the whole meaning of this sheet, and a second
// copy would eventually disagree with the filed one.
//
// Nothing here may import mongoose or React.

export interface SumStudent { _id: string; school_id: string; sex: string }
export interface SumIptr { _id: string; student_id: string; school_year: string }
export interface SumOral { iptr_id: string; gingivitis?: boolean; debris?: boolean; calculus?: boolean }
export interface SumChart { _id: string; iptr_id: string }
export interface SumTooth { chart_id: string; condition?: string | null; treatment_code?: string | null }
export interface SumSchool { _id: string; school_name: string }

export interface SchoolSummaryInput {
  schools: SumSchool[];
  students: SumStudent[];
  iptrs: SumIptr[];
  orals: SumOral[];
  charts: SumChart[];
  toothRecords: SumTooth[];
  schoolName: string | null;
  schoolYear: string | null;
}

export interface SchoolSummaryOutput {
  tally: SchoolSummaryTally;
  years: string[];
  /** Pupils whose sex is blank or unrecognised: counted in no column, and said
   *  out loud on screen rather than quietly folded into one. */
  unsexed: number;
}

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


export function buildSchoolSummary(input: SchoolSummaryInput): SchoolSummaryOutput {
  const { schools, students, iptrs, orals, charts, toothRecords, schoolName, schoolYear } = input;

  const years = [...new Set(iptrs.map((i) => i.school_year))].sort().reverse();

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

  const oralByIptr = new Map<string, SumOral>();
  for (const o of orals) oralByIptr.set(o.iptr_id, o);

  const chartIdsByIptr = new Map<string, string[]>();
  for (const c of charts) {
    const list = chartIdsByIptr.get(c.iptr_id) ?? [];
    list.push(c._id);
    chartIdsByIptr.set(c.iptr_id, list);
  }
  const toothByChart = new Map<string, SumTooth[]>();
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


  return { tally: next, years, unsexed: skipped };
}
