import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { RPCRow, RpcListPage, RpcListQuery } from '../../../shared/rpcTracking';

export { SOUND_TEMPORARY, SOUND_PERMANENT } from '../../../shared/rpcTracking';
export type { RPCRow, RpcListQuery } from '../../../shared/rpcTracking';

// ⚠ Sprint 140 moved this join to the server; Sprint 146 moved the FILTERS and
// the PAGING with it. Filtering in the browser is what forced the endpoint to
// send every pupil (685 B/row — ~5.5 MB at 8,000), and paging the query while
// the filters stayed client-side would have filtered only the visible page.
//
// ⚠ `total`, `schoolTotal` and `sectionOptions` come back computed over the
// population, never the page: the pager's "of N" and its "(filtered from N)"
// have to describe the roll, and a section dropdown listing only this page's
// sections hides the one you need next.
const EMPTY: RpcListPage = { rows: [], total: 0, schoolTotal: 0, sectionOptions: [], funnel: { enrolled: 0, visit1: 0, both: 0, overdue: 0, complete: 0 } };

export function useRPCTracking(query: RpcListQuery = {}) {
  const [page, setPage] = useState<RpcListPage>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Serialised so a changed FILTER re-runs the effect, not a new object
  // identity on every render.
  const key = JSON.stringify(query);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const q: RpcListQuery = JSON.parse(key);
      const params = new URLSearchParams();
      if (q.q) params.set('q', q.q);
      if (q.school) params.set('school', q.school);
      if (q.grade && q.grade !== 'all') params.set('grade', q.grade);
      if (q.section && q.section !== 'all') params.set('section', q.section);
      if (q.gender && q.gender !== 'all') params.set('gender', q.gender);
      if (q.ageGroup && q.ageGroup !== 'all') params.set('age_group', q.ageGroup);
      if (q.status) params.set('status', q.status);
      if (q.treatment && q.treatment !== 'all') params.set('treatment', q.treatment);
      if (q.limit) params.set('limit', String(q.limit));
      if (q.offset) params.set('offset', String(q.offset));
      const qs = params.toString();
      const data = await apiClient.get<RpcListPage>(`/stats/rpc-rows${qs ? `?${qs}` : ''}`);
      setPage(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load RPC records');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => { void reload(); }, [reload]);

  return {
    records: page.rows as RPCRow[],
    /** Population-wide, never the page — see filterRpcRows. */
    funnel: page.funnel,
    total: page.total,
    schoolTotal: page.schoolTotal,
    sectionOptions: page.sectionOptions,
    loading,
    error,
    reload,
  };
}
