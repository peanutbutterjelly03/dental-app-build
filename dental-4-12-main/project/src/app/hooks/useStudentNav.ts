import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

export interface StudentNavEntry {
  id: string;
  /** Surname-first display string — the nav sorts on this. */
  name: string;
  /** Shown alone on the prev/next buttons, which name the surname because the
   *  list is ordered by surname. Falls back to `name` when empty. */
  lastName: string;
  school: string;
}

/**
 * The prev/next patient list for the dental chart, and nothing else.
 *
 * DentalChart used to call useStudents() for this, which fetches the whole
 * roster through /stats/student-rows — ~13 fields per student, joined across
 * six collections to compute a last-visit date and risk badge the nav never
 * reads (backlog #39). This asks for the three fields it actually uses.
 *
 * Deliberately NOT paginated: prev/next is a position within the full ordered
 * roster, so a page of 25 cannot answer "what comes after this student?".
 * Making the payload thin is the fix available without changing that meaning.
 */
export function useStudentNav() {
  const [entries, setEntries] = useState<StudentNavEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiClient.get<StudentNavEntry[]>('/stats/student-nav');
        if (!cancelled) setEntries(rows);
      } catch {
        // The nav is a convenience; a failure here must not blank the chart.
        // Prev/next simply disappear, which is what an empty list already does.
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { entries, loading };
}
