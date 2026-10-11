import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useRefreshOnFocus } from './useRefreshOnFocus';
import { useLiveNumbers } from './useLiveNumbers';
import type { SchoolSummaryTally, SchoolSummaryOutput } from '../../../shared/schoolSummary';

export {
  PERMANENT_CODES,
  TEMPORARY_CODES,
  CARIES_CODES,
} from '../../../shared/schoolSummary';
export type { SchoolSummaryTally, Sex, BySex } from '../../../shared/schoolSummary';

// ⚠ Sprint 141 MOVED this tally to the server. It used to fetch SIX whole
// collections — students, IPTRs, oral-health conditions, dental charts, tooth
// records and schools — to draw thirteen rows of counts.
//
// The logic lives in `shared/schoolSummary.ts` and is MOVED, not copied: the
// MALE/FEMALE-counts-STUDENTS vs TOTAL-counts-TEETH rule is the whole meaning
// of this sheet, and a second copy would eventually disagree with the filed
// one.
//
// The output is COUNTS, so unlike the risk and RPC endpoints this response is
// flat — it does not grow with the roll.

const emptyTally = (): SchoolSummaryTally => ({
  students: { Male: 0, Female: 0 },
  examined: { Male: 0, Female: 0 },
  personsByCode: {},
  teethByCode: {},
  personsByCondition: {},
  noFluoride: { Male: 0, Female: 0 },
});

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
      // Scoped SERVER-side; filtering after the fact would put the whole
      // population back on the wire.
      const params = new URLSearchParams();
      if (schoolName) params.set('school', schoolName);
      if (schoolYear) params.set('school_year', schoolYear);
      const qs = params.toString();
      const data = await apiClient.get<SchoolSummaryOutput>(`/stats/school-summary${qs ? `?${qs}` : ''}`);
      if (isStale()) return;
      setTally(data.tally ?? emptyTally());
      setYears(data.years ?? []);
      setUnsexed(data.unsexed ?? 0);
      setError(null);
    } catch (err) {
      if (isStale()) return;
      setError(err instanceof Error ? err.message : 'Could not load the school summary.');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [schoolName, schoolYear]);

  useEffect(() => { void load(); }, [load]);

  // Sprint 104 — read-only report, same freshness rule as the other two.
  useRefreshOnFocus(load);
  const { lastUpdated } = useLiveNumbers(load);

  return {
    /** When the numbers were last actually re-read (Sprint 110). */
    lastUpdated,
    tally,
    /** School years present in the data, newest first. */
    years,
    /** Pupils whose sex is blank or unrecognised: counted in no column, and
     *  said out loud on screen rather than quietly folded into one. */
    unsexedCount: unsexed,
    loading,
    error,
    reload: load,
  };
}
