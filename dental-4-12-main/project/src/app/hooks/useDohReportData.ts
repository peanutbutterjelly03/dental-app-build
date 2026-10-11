import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useRefreshOnFocus } from './useRefreshOnFocus';
import { useLiveNumbers } from './useLiveNumbers';
import { useLoadPhase } from './useLoadPhase';
import {
  ORDINAL_TREATMENTS,
  HEAD_TOOTH_TREATMENTS,
  REAL_MEDICAL_FIELDS,
  REAL_DIETARY_FIELDS,
  REAL_ORAL_FIELDS,
  GRADE_ALL,
  GRADE_NOT_RECORDED,
} from '../../../shared/dohAggregate';

export { GRADE_ALL, GRADE_NOT_RECORDED, ageAt, tallyIptrServices } from '../../../shared/dohAggregate';

// ─── DOH report data ───────────────────────────────────────────────────────
//
// ⚠ Sprint 138 MOVED the arithmetic to the server. This hook used to fetch
// ELEVEN WHOLE COLLECTIONS and join them in the browser — measured 2026-09-05
// at ~108 KB for 26 pupils (~4.1 KB each), so roughly 32 MB at the Chapter 1
// scale of 8,000, and 60-80 MB once mouths are charted at 20-32 teeth rather
// than the demo's ~5. It now makes ONE request to `/stats/doh-report`, whose
// response is a few KB whatever the roll size.
//
// The joining logic lives in `shared/dohAggregate.ts` and is MOVED, not
// duplicated: two implementations of a DOH return would drift, and the drift
// would show up as two different numbers on a filed document.
//
// What did NOT change: `getRealCount` / `getRealTotal` and the REAL_FIELDS
// allowlist below, which is what keeps "no source" honest — a field not named
// there returns null and the form prints "—".

/** Shape of `/stats/doh-report`. */
interface DohReportResponse {
  counts: Record<string, number>;
  years: string[];
  unplaced: number;
}

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
      // The school and year are applied SERVER-SIDE now. Passing them in the
      // query is what makes the response small; filtering after the fact would
      // put the whole population back on the wire.
      const params = new URLSearchParams();
      if (schoolYear) params.set('school_year', schoolYear);
      if (schoolName) params.set('school', schoolName);
      const qs = params.toString();
      const data = await apiClient.get<DohReportResponse>(`/stats/doh-report${qs ? `?${qs}` : ''}`);
      if (isStale()) return;

      setCounts(new Map(Object.entries(data.counts ?? {})));
      setYears(data.years ?? []);
      setUnplaced(data.unplaced ?? 0);
      // Clear a previous failure: a refresh that succeeds must not leave the
      // old error banner sitting above correct numbers.
      setError(null);
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

  // Sprint 104 extracted this; it used to be inlined here and existed on no
  // other hook. See useRefreshOnFocus for why an interval is the wrong shape.
  useRefreshOnFocus(load);
  // Sprint 110 — and while the tab IS open, poll the change token so someone
  // else's save shows up here without the user doing anything.
  const { lastUpdated } = useLiveNumbers(load);

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
    /** When the numbers were last actually re-read (Sprint 110). */
    lastUpdated,
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
