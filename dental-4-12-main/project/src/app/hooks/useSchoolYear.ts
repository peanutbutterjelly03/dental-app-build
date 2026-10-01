import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { RolloverStatus } from '../../../shared/schoolYearRollover';

// One school's standing for the school year being started (SCHOOL_YEAR_ROLLOVER,
// read through GET /school-year/status). `assigned` is how many active pupils
// still carry a grade or section -- the ones starting the year will clear.
export interface SchoolYearSchool {
  id: string;
  name: string;
  students: number;
  assigned: number;
  status: RolloverStatus;
  startKind: 'all' | 'early' | null;
  requestId: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  startedAt: string | null;
}

export interface SchoolYearStatus {
  currentYear: string;
  nextYear: string;
  /** "YYYY-MM-DD", or null while the System Admin has not set one. */
  plannedStart: string | null;
  schools: SchoolYearSchool[];
}

/**
 * Update School Year page data. Every write here goes to /school-year/*, which
 * the API client never queues offline (a password and a real start are not
 * things to replay later), so a failure surfaces to the caller to show.
 */
export function useSchoolYear(enabled: boolean) {
  const [status, setStatus] = useState<SchoolYearStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setStatus(await apiClient.get<SchoolYearStatus>('/school-year/status'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the school year.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void reload(); }, [reload]);

  return {
    status,
    loading,
    error,
    reload,
    setPlan: (plannedStart: string, password: string) => apiClient.put('/school-year/plan', { planned_start: plannedStart, password }),
    startAll: (password: string) => apiClient.post<{ schoolsStarted: number; studentsCleared: number }>('/school-year/start-all', { password }),
    requestEarly: (schoolId: string) => apiClient.post('/school-year/request', { school_id: schoolId }),
    approve: (requestId: string) => apiClient.post<{ studentsCleared: number }>(`/school-year/requests/${requestId}/approve`, {}),
    decline: (requestId: string) => apiClient.post(`/school-year/requests/${requestId}/decline`, {}),
  };
}
