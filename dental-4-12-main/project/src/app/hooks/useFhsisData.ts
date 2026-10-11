import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useRefreshOnFocus } from './useRefreshOnFocus';
import { useLiveNumbers } from './useLiveNumbers';
import type { ApiSchool } from '../api/types';
import type { Counts, FhsisOutput } from '../../../shared/fhsis';
import { emptyCounts } from '../../../shared/fhsis';

export { FHSIS_BANDS } from '../../../shared/fhsis';
export type { FhsisBandKey, Sex, Measure, MeasureCounts } from '../../../shared/fhsis';

// ⚠ Sprint 142 MOVED this tally to the server. It used to fetch FOUR whole
// collections — students, IPTRs, preventive-care records and schools — to draw
// one month of counts.
//
// The logic lives in `shared/fhsis.ts` and is MOVED, not copied: the "within a
// year" qualifier on a completed 2nd visit, and the rule that an unrecorded
// `facility_based` lands in `unrecorded` rather than being guessed into a or
// b, are what make this return honest.
//
// The output is COUNTS, so the response is flat — it does not grow with the
// roll.
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
      // Month and school are applied SERVER-side; filtering afterwards would
      // put the whole population back on the wire.
      const params = new URLSearchParams();
      if (month) params.set('month', month);
      if (schoolName) params.set('school', schoolName);
      const qs = params.toString();
      const data = await apiClient.get<FhsisOutput & { schools: ApiSchool[] }>(
        `/stats/fhsis${qs ? `?${qs}` : ''}`,
      );
      setCounts(data.counts ?? emptyCounts());
      setSchools(data.schools ?? []);
      setMonthsWithData(data.monthsWithData ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FHSIS data');
    } finally {
      setLoading(false);
    }
  }, [month, schoolName]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sprint 104: the FHSIS return goes to the City Health Office like the DOH
  // Consolidated report does, so the same freshness argument applies.
  useRefreshOnFocus(load);
  const { lastUpdated } = useLiveNumbers(load);

  return { counts, schools, monthsWithData, loading, error, reload: load, lastUpdated };
}
