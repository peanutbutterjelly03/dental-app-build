import { useCallback, useEffect, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import type { RiskCandidate, RiskListPage, RiskListQuery } from '../../../shared/riskCandidates';

export type {
  RiskCandidate,
  RiskHistoryEntry,
  StudentMlFeatures,
  RiskListQuery,
} from '../../../shared/riskCandidates';

// ⚠ Sprint 139 moved this join to the server; Sprint 145 moved the FILTERS,
// the SORT and the PAGING with it. Filtering in the browser is what forced the
// endpoint to send every pupil (measured 673 B/row — ~5.4 MB at 8,000), and
// paging the query while the filters stayed client-side would have produced
// filters that only filter the current page.
//
// ⚠ `counts`, `gradeOptions` and `sectionOptions` come back computed over the
// WHOLE filtered population, never the page: the risk tiles must describe the
// roll, and a grade dropdown listing only page 1's grades is a trap.
const EMPTY: RiskListPage = {
  rows: [],
  total: 0,
  counts: { High: 0, Medium: 0, Low: 0, unassessed: 0, worsening: 0, improving: 0 },
  gradeOptions: [],
  sectionOptions: [],
};

export function useRiskClassification(query: RiskListQuery = {}) {
  const [page, setPage] = useState<RiskListPage>(EMPTY);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);

  // Serialised so the effect below re-runs on a changed FILTER, not on a new
  // object identity every render.
  const key = JSON.stringify(query);

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const q: RiskListQuery = JSON.parse(key);
      const params = new URLSearchParams();
      if (q.q) params.set('q', q.q);
      if (q.school) params.set('school', q.school);
      if (q.grade && q.grade !== 'all') params.set('grade', q.grade);
      if (q.section && q.section !== 'all') params.set('section', q.section);
      if (q.risk && q.risk !== 'all') params.set('risk', q.risk);
      if (q.gender && q.gender !== 'all') params.set('gender', q.gender);
      if (q.ageGroup && q.ageGroup !== 'all') params.set('age_group', q.ageGroup);
      if (q.sort) params.set('sort', q.sort);
      if (q.limit) params.set('limit', String(q.limit));
      if (q.offset) params.set('offset', String(q.offset));
      const qs = params.toString();
      const data = await apiClient.get<RiskListPage>(`/stats/risk-candidates${qs ? `?${qs}` : ''}`);
      setPage(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load student data');
    } finally {
      endLoad();
    }
  }, [key, beginLoad, endLoad]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    candidates: page.rows as RiskCandidate[],
    total: page.total,
    counts: page.counts,
    gradeOptions: page.gradeOptions,
    sectionOptions: page.sectionOptions,
    loading,
    error,
    reload,
  };
}
