import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { ApiSchool } from '../api/types';

// ─── The school list, from the database ──────────────────────────────────────
// Every school dropdown in the app used to be a hardcoded array — the same
// three names copied into PatientList, Appointments, DentalChart and Reports,
// plus short-name and colour maps in utils. Adding a fourth school meant
// editing five files, and a school created through the admin API would appear
// in none of them.
//
// That is a cosmetic dropdown by CLAUDE.md's rule: it looks like the system's
// list of schools and is actually a constant. This hook makes it the real one.
//
// Not cached across mounts on purpose. The list is three rows today and a few
// dozen at the barangay's scale-out ceiling, and a stale school list on a form
// that writes `school_id` is worse than one extra request.

export function useSchools() {
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiClient.get<ApiSchool[]>('/schools');
      // Alphabetical so the dropdowns have a stable, predictable order rather
      // than insertion order, which is whatever the seeder happened to do.
      setSchools([...rows].sort((a, b) => a.school_name.localeCompare(b.school_name)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return {
    schools,
    /** Just the names — what the form dropdowns bind to. */
    schoolNames: schools.map((s) => s.school_name),
    loading,
    error,
    reload,
  };
}
