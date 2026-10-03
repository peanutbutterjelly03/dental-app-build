import { useCallback, useEffect, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import type { ApiDentistRotation, ApiSchool, ApiDentist } from '../api/types';

export interface RotationRow {
  id: string;
  school: string;
  dentist: string;
  weekStart: string;
  weekEnd: string;
  notes: string;
}

export function useDentistRotations() {
  const [rotations, setRotations] = useState<RotationRow[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const [apiRotations, schools, dentists] = await Promise.all([
        apiClient.get<ApiDentistRotation[]>('/dentist-rotations'),
        apiClient.get<ApiSchool[]>('/schools'),
        apiClient.get<ApiDentist[]>('/dentists'),
      ]);
      const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
      const dentistNameById = new Map(dentists.map((d) => [d._id, `Dr. ${d.first_name} ${d.last_name}`]));

      setRotations(
        apiRotations.map((r) => ({
          id: r._id,
          school: schoolNameById.get(r.school_id) ?? 'Unknown School',
          dentist: dentistNameById.get(r.dentist_id) ?? 'Unassigned',
          weekStart: r.week_start.slice(0, 10),
          weekEnd: r.week_end.slice(0, 10),
          notes: r.notes,
        })),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rotations');
    } finally {
      endLoad();
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { rotations, loading, error, reload };
}
