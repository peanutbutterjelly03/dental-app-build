import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { dmftRecordsForYear } from '../utils/dentalChartCodes';
import type {
  ApiStudent,
  ApiSchool,
  ApiStudentIptr,
  ApiMedicalHistory,
  ApiDietarySocialHabits,
  ApiOralHealthCondition,
  ApiDentalChart,
  ApiToothRecord,
  ApiTreatment,
  ApiReferral,
  ApiDentist,
  ApiPreventiveCareRecord,
} from '../api/types';

export interface IptrYearData {
  iptr: ApiStudentIptr;
  medicalHistory: ApiMedicalHistory | null;
  dietaryHabits: ApiDietarySocialHabits | null;
  oralCondition: ApiOralHealthCondition | null;
  /** EVERY charting recorded for this school year, oldest first (Sprint 148).
   *
   *  ⚠ There is usually more than one: measured on dev 2026-09-05, **22 of 26
   *  IPTRs have two or more**, one has three. The screen used to render
   *  `charts[0]` and silently hide the rest — a pupil with three chartings
   *  showed 3 of their 4 tooth records.
   *
   *  The dentist screens and treats at the SAME visit (user, 2026-09-05), so
   *  each charting is self-contained: that visit's findings and the treatments
   *  done at it. They are read one at a time, never merged. */
  charts: ApiDentalChart[];
  /** Visit number of each charting, keyed by chart id (Sprint 149). Absent
   *  means the charting is attached to no visit — every chart made before that
   *  sprint, and any made from the chart screen rather than from Record Visit. */
  visitNumberByChart: Record<string, 1 | 2>;
  /** The RPC visit each charting is attached to, keyed by chart id (Sprint 154).
   *  The chart screen needs the record itself, not only its ordinal, because
   *  the services given at a visit — screening, prophylaxis, varnish, hygiene
   *  instruction — live on it and are edited there. Same absence rule as
   *  `visitNumberByChart`: no entry means the charting is attached to no visit,
   *  and there is therefore nowhere to record a service against. */
  preventiveByChart: Record<string, ApiPreventiveCareRecord>;
  /** The charting currently being viewed — **the LATEST by date**, which is
   *  the current state of the mouth. It used to be the OLDEST, which is what
   *  made later work invisible. */
  dentalChart: ApiDentalChart | null;
  /** Tooth records of `dentalChart` alone — one charting is one visit. */
  toothRecords: ApiToothRecord[];
  /** Tooth records of EVERY charting, keyed by chart id, so the screen can
   *  switch between chartings without another round trip. */
  toothRecordsByChart: Record<string, ApiToothRecord[]>;
  /** Tooth records of the latest charting that actually HAS any — or `null`
   *  when no charting this year recorded a single tooth (BUG-12).
   *
   *  ⚠ THIS IS NOT `toothRecords`, AND THE DIFFERENCE IS THE BUG. `toothRecords`
   *  is the charting being VIEWED, which is right for the editor: open a fresh
   *  charting and you must see it empty, because you are about to fill it in.
   *  It is wrong for a YEAR SUMMARY. Measured 2026-09-11: a pupil with 14
   *  decayed permanent teeth on a Sep 6 charting and an empty Sep 7 charting
   *  after it had the year reported as `DMFT: 0`, Trend "Stable" — a clinical
   *  screen stating there is no disease.
   *
   *  `null` means NOT RECORDED and must render as such, never as 0 (user,
   *  2026-09-14). The distinction is the whole point: **0 means examined and
   *  no decay found; `null` means nothing was charted.** A charting whose teeth
   *  are all sound therefore still gives 0, correctly — it has records.
   *
   *  Derived here rather than in each screen so the year strip and the DMFT
   *  History table cannot drift apart, which is the failure BUG-02 and BUG-11
   *  both record. */
  dmftToothRecords: ApiToothRecord[] | null;
  treatments: ApiTreatment[];
  referrals: ApiReferral[];
}

export function useDentalChartData(studentId: string | undefined) {
  const [student, setStudent] = useState<ApiStudent | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [years, setYears] = useState<IptrYearData[]>([]);
  const [dentists, setDentists] = useState<ApiDentist[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  // BUG-07. Only the most recently started run may commit. The same guard
  // useDohReportData uses — this hook simply never had it, while useStudentNav,
  // which drives the prev/next buttons on the very same screen, did.
  //
  // ⚠ THIS HOOK NEEDS THE CHECK IN TWO PLACES, WHICH IS WHY THE BUG WAS WORSE
  // THAN ORDINARY STALENESS. It commits identity (student, school, dentists)
  // after the FIRST round of requests and the chart years after the SECOND, so
  // with two runs in flight the interleaving A-first, B-first, A-second left
  // pupil B's name and school sitting above pupil A's chart years — a
  // clinically wrong record with no error and no empty state to give it away.
  // Guarding only the last commit would still allow exactly that.
  const runIdRef = useRef(0);

  const reload = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isStale = () => runId !== runIdRef.current;
    if (!studentId) {
      endLoad();
      return;
    }
    beginLoad();
    try {
      // Every list below is fetched FILTERED to this student (Sprint 48).
      // It used to pull whole collections and filter them here — every IPTR,
      // medical history, chart and tooth record in the database, to find the
      // ~3 rows belonging to one child. Measured at 14-58 MB per open at the
      // 8,000-student scale. The join keys are unencrypted ObjectIds, so the
      // server can match them (encrypted fields could not — see CLAUDE.md).
      const [studentDoc, schools, myIptrsRaw, dentistList] = await Promise.all([
        apiClient.get<ApiStudent>(`/students/${studentId}`),
        apiClient.get<ApiSchool[]>('/schools'),
        apiClient.get<ApiStudentIptr[]>(`/student-iptrs?student_id=${studentId}`),
        apiClient.get<ApiDentist[]>('/dentists'),
      ]);

      // COMMIT POINT 1 of 2 — identity. A newer run has started, so this one
      // must not put its pupil's name on screen, and must not fall through to
      // the second round either.
      if (isStale()) return;
      setStudent(studentDoc);
      setSchoolName(schools.find((s) => s._id === studentDoc.school_id)?.school_name ?? 'Unknown School');
      setDentists(dentistList);

      const myIptrs = [...myIptrsRaw].sort((a, b) => a.school_year.localeCompare(b.school_year));
      const iptrIds = new Set(myIptrs.map((i) => i._id));

      // A student with no IPTR years has nothing to join to — skip five
      // round-trips that could only return empty.
      const iptrQuery = myIptrs.map((i) => i._id).join(',');
      const [allMedical, allDiet, allOral, allCharts, allTreatments, allReferrals, allPreventives] = iptrQuery
        ? await Promise.all([
            apiClient.get<ApiMedicalHistory[]>(`/medical-histories?iptr_id=${iptrQuery}`),
            apiClient.get<ApiDietarySocialHabits[]>(`/dietary-social-habits?iptr_id=${iptrQuery}`),
            apiClient.get<ApiOralHealthCondition[]>(`/oral-health-conditions?iptr_id=${iptrQuery}`),
            apiClient.get<ApiDentalChart[]>(`/dental-charts?iptr_id=${iptrQuery}`),
            apiClient.get<ApiTreatment[]>(`/treatments?iptr_id=${iptrQuery}`),
            apiClient.get<ApiReferral[]>(`/referrals?iptr_id=${iptrQuery}`),
            // One more filtered read, and a deliberate one: it is what lets a
            // charting say "Visit 1" instead of only a date (Sprint 149).
            apiClient.get<ApiPreventiveCareRecord[]>(`/preventive-care-records?iptr_id=${iptrQuery}`),
          ])
        : [[], [], [], [], [], [], []];

      const myCharts = allCharts.filter((c) => iptrIds.has(c.iptr_id));
      const chartIds = myCharts.map((c) => c._id);
      const allToothRecords = chartIds.length
        ? await apiClient.get<ApiToothRecord[]>(`/tooth-records?chart_id=${chartIds.join(',')}`)
        : [];

      const yearData: IptrYearData[] = myIptrs.map((iptr) => {
        // ⚠ ALL of them, oldest first — `.find()` here is what hid every
        // charting after the first (Sprint 148).
        const charts = myCharts
          .filter((c) => c.iptr_id === iptr._id)
          .sort((a, b) => a.date_charted.localeCompare(b.date_charted));
        // The latest is the current state of the mouth. The old code took the
        // first, so a pupil charted again in January showed August's findings.
        const dentalChart = charts.length ? charts[charts.length - 1] : null;
        const visitNumberByChart: Record<string, 1 | 2> = {};
        const preventiveByChart: Record<string, ApiPreventiveCareRecord> = {};
        for (const c of charts) {
          const visit = c.preventive_id
            ? allPreventives.find((v) => v._id === c.preventive_id)
            : undefined;
          if (visit) {
            visitNumberByChart[c._id] = visit.visit_number;
            preventiveByChart[c._id] = visit;
          }
        }
        return {
          visitNumberByChart,
          preventiveByChart,
          charts,
          iptr,
          medicalHistory: allMedical.find((m) => m.iptr_id === iptr._id) ?? null,
          dietaryHabits: allDiet.find((d) => d.iptr_id === iptr._id) ?? null,
          oralCondition: allOral.find((o) => o.iptr_id === iptr._id) ?? null,
          dentalChart,
          toothRecords: dentalChart ? allToothRecords.filter((t) => t.chart_id === dentalChart._id) : [],
          toothRecordsByChart: Object.fromEntries(
            charts.map((c) => [c._id, allToothRecords.filter((t) => t.chart_id === c._id)]),
          ),
          // BUG-12 — `charts` is sorted oldest-first, and the rule lives in a
          // pure function so it is testable and cannot drift between the year
          // strip and the DMFT History table.
          dmftToothRecords: dmftRecordsForYear(
            charts.map((c) => allToothRecords.filter((t) => t.chart_id === c._id)),
          ),
          treatments: allTreatments.filter((t) => t.iptr_id === iptr._id),
          referrals: allReferrals.filter((r) => r.iptr_id === iptr._id),
        };
      });

      // COMMIT POINT 2 of 2 — the chart years.
      if (isStale()) return;
      setYears(yearData);
      setError(null);
    } catch (err) {
      // A superseded run's failure is not this screen's failure: showing "Failed
      // to load" for a pupil the user already navigated away from would be a
      // second way to mislead.
      if (!isStale()) setError(err instanceof Error ? err.message : 'Failed to load dental chart data');
    } finally {
      // ⚠ Only the newest run may clear the spinner. Without this an abandoned
      // run finishing first would report the screen ready while the run whose
      // data is actually wanted is still in flight.
      if (!isStale()) endLoad();
    }
  }, [studentId]);

  useEffect(() => {
    reload();
    // Bump the run id on unmount so an in-flight fetch can never commit —
    // matching useDohReportData.
    return () => { runIdRef.current++; };
  }, [reload]);

  return { student, schoolName, years, dentists, loading, error, reload };
}
