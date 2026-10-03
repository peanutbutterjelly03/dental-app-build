import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { ApiSchool, ApiStudent, ApiStudentIptr, ApiPreventiveCareRecord } from '../api/types';

// ─── FHSIS Section D — Oral Health Care Services ─────────────────────────────
// Backs the SCHOOL-stamped FHSIS form (the uploaded workbook has two variants:
// one headed "Health Center:", one headed "School:" — this is the latter, the
// level Floral is scoped to).
//
// The form counts two events per age band and sex:
//   * a FIRST visit to an oral health care professional within a year
//   * COMPLETED 2 visits within a year
// which is exactly the two-visit RPC module (CLAUDE.md module 5), so unlike the
// Program Report's Services Rendered rows these numbers are real.
//
// ⚠ Reads whole collections and joins client-side, like every other report
// hook. Fine at demo scale, and it is NOT laziness: "completed 2 visits within
// a year" needs each student's visit-1 date, which may fall outside the report
// month, so a month-bounded fetch could not answer it on its own. Tracked by
// backlog 0b/24 with the other list hooks; fix them together, server-side.

/** Whole years completed at `on`. Month/day matters: a child born in December
 *  2015 is 10 in April 2026, not 11 — the same adjustment useDohReportData
 *  makes, and the reason ages are computed AT THE VISIT, not today. */
const ageAt = (birthday: string, on: Date): number | null => {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return null;
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age -= 1;
  return age < 0 ? null : age;
};

/** The form's age bands, in printed order. `min`/`max` are inclusive years. */
export const FHSIS_BANDS = [
  { key: 'infants',     label: 'Infants 0-11 months old',            min: 0,  max: 0  },
  { key: 'children1to4', label: 'Children 1-4 years old',            min: 1,  max: 4  },
  { key: 'children5to9', label: 'Children 5-9 years old',            min: 5,  max: 9  },
  { key: 'adolescents', label: 'Adolescents 10-19 years old',        min: 10, max: 19 },
  { key: 'adults',      label: 'Adults 20-59 years old',             min: 20, max: 59 },
  { key: 'seniors',     label: 'Senior Citizens 60 years old and above', min: 60, max: 200 },
] as const;

export type FhsisBandKey = typeof FHSIS_BANDS[number]['key'];
export type Sex = 'male' | 'female';
/** first = 1st visit in the month; completed = 2nd visit in the month, with
 *  visit 1 inside the preceding year. */
export type Measure = 'first' | 'completed';

type Cell = Record<Sex, number>;
/** `male`/`female` stay the BAND TOTAL, so existing callers are unchanged.
 *  The three sub-tallies split that total by PREVENTIVE_CARE_RECORD
 *  .facility_based for the form's `a`/`b` sub-rows. `unrecorded` is the
 *  remainder — visits whose flag is null (everything created before Sprint 81)
 *  — and it is carried explicitly rather than folded into either sub-row, so
 *  a + b can be honestly less than the total instead of silently wrong. */
export type MeasureCounts = Cell & { facility: Cell; nonFacility: Cell; unrecorded: Cell };
type Counts = Record<FhsisBandKey, Record<Measure, MeasureCounts>>;

const emptyCell = (): Cell => ({ male: 0, female: 0 });
const emptyMeasure = (): MeasureCounts => ({
  ...emptyCell(),
  facility: emptyCell(),
  nonFacility: emptyCell(),
  unrecorded: emptyCell(),
});

const emptyCounts = (): Counts =>
  Object.fromEntries(
    FHSIS_BANDS.map((b) => [b.key, { first: emptyMeasure(), completed: emptyMeasure() }]),
  ) as Counts;

const sameMonth = (d: Date, month: string) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month;

export function useFhsisData(month: string, schoolName: string) {
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [monthsWithData, setMonthsWithData] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [students, iptrs, pcrs, schoolList] = await Promise.all([
        apiClient.get<ApiStudent[]>('/students'),
        apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
        apiClient.get<ApiPreventiveCareRecord[]>('/preventive-care-records'),
        apiClient.get<ApiSchool[]>('/schools'),
      ]);
      setSchools(schoolList);

      const studentById = new Map(students.map((s) => [s._id, s]));
      const iptrById = new Map(iptrs.map((i) => [i._id, i]));
      const schoolIdByName = new Map(schoolList.map((s) => [s.school_name, s._id]));
      const wantedSchoolId = schoolName ? schoolIdByName.get(schoolName) : undefined;

      /** The student behind a preventive-care record, or null if the chain is
       *  broken or the record belongs to another school. */
      const studentFor = (p: ApiPreventiveCareRecord): ApiStudent | null => {
        const iptr = iptrById.get(p.iptr_id);
        if (!iptr) return null;
        const student = studentById.get(iptr.student_id);
        if (!student) return null;
        if (wantedSchoolId && student.school_id !== wantedSchoolId) return null;
        return student;
      };

      // Visit 1 dates per IPTR, so a visit 2 can be checked for the "within a
      // year" qualifier the form asks for.
      const firstVisitDate = new Map<string, Date>();
      for (const p of pcrs) {
        if (p.visit_number !== 1) continue;
        const d = new Date(p.visit_date);
        if (Number.isNaN(d.getTime())) continue;
        const prev = firstVisitDate.get(p.iptr_id);
        if (!prev || d < prev) firstVisitDate.set(p.iptr_id, d);
      }

      const next = emptyCounts();
      const months = new Set<string>();

      for (const p of pcrs) {
        const when = new Date(p.visit_date);
        if (Number.isNaN(when.getTime())) continue;
        const student = studentFor(p);
        if (!student) continue;
        months.add(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`);
        if (!sameMonth(when, month)) continue;

        const sexRaw = (student.sex ?? '').trim().toLowerCase();
        const sex: Sex | null = sexRaw.startsWith('m') ? 'male' : sexRaw.startsWith('f') ? 'female' : null;
        const age = ageAt(student.birthday, when);
        if (sex === null || age === null) continue; // no truthful cell to add to

        const band = FHSIS_BANDS.find((b) => age >= b.min && age <= b.max);
        if (!band) continue;

        // Adds one to the band total AND to whichever facility sub-tally the
        // record's flag names. null (not recorded) lands in `unrecorded`, never
        // in `a` or `b` — guessing it is exactly what this report refuses to do.
        const tally = (m: MeasureCounts) => {
          m[sex] += 1;
          const bucket = p.facility_based === true ? m.facility : p.facility_based === false ? m.nonFacility : m.unrecorded;
          bucket[sex] += 1;
        };

        if (p.visit_number === 1) {
          tally(next[band.key].first);
        } else if (p.visit_number === 2) {
          const v1 = firstVisitDate.get(p.iptr_id);
          if (!v1) continue; // a 2nd visit with no recorded 1st cannot be "completed 2"
          const aYearBefore = new Date(when);
          aYearBefore.setFullYear(aYearBefore.getFullYear() - 1);
          if (v1 >= aYearBefore) tally(next[band.key].completed);
        }
      }

      setCounts(next);
      setMonthsWithData([...months].sort().reverse());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FHSIS data');
    } finally {
      setLoading(false);
    }
  }, [month, schoolName]);

  useEffect(() => {
    void load();
  }, [load]);

  return { counts, schools, monthsWithData, loading, error, reload: load };
}
