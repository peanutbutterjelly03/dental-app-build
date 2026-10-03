import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import type { ApiStudent } from '../api/types';
import { surnameFirst } from '../utils/studentName';

export interface RosterStudent {
  id: string;
  name: string;
  gender: string;
  birthdate: string;
  section: string;
}

/** The students of ONE school + grade, for the appointment create form's
 *  section picker.
 *
 *  Replaces a `useStudents()` call on the Appointments screen (Sprint 56).
 *  That hook exists to build the full patient list — it pulls students, schools,
 *  IPTRs, dental charts, preventive care records and risk stratifications, six
 *  whole collections, and joins them into rows carrying risk level and last
 *  visit. This form needs a name, a sex and a birthday for one section, and
 *  none of the clinical joins, so at the Chapter 1 scale of ~8,000 students it
 *  was the most expensive read on the screen by a wide margin.
 *
 *  Fetches per grade rather than per section because the section dropdown has
 *  to list the sections that exist before one can be chosen — one indexed query
 *  answers both that and the roster.
 *
 *  Returns nothing until both arguments are set: an empty school or grade would
 *  otherwise drop the filter and ask for the whole collection, which is the
 *  exact bug this replaces. */
export function useGradeRoster(schoolId: string | undefined, grade: string) {
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!schoolId || !grade) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ school_id: schoolId, grade_level: grade });
    apiClient
      .get<ApiStudent[]>(`/students?${params}`)
      .then((rows) => {
        if (!cancelled) setStudents(rows);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, grade]);

  const roster = useMemo<RosterStudent[]>(
    () =>
      students.map((s) => ({
        id: s._id,
        name: surnameFirst(s),
        gender: s.sex,
        birthdate: s.birthday.slice(0, 10),
        section: s.section,
      })),
    [students],
  );

  const sections = useMemo(
    () => [...new Set(roster.map((s) => s.section))].sort(),
    [roster],
  );

  return { roster, sections, loading };
}
