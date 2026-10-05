import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { cachedGet } from '../utils/apiCache';

const STUDENT_NAV_CACHE_KEY = '/stats/student-nav';

export interface StudentNavEntry {
  id: string;
  /** Surname-first display string — the default-context nav sorts on this. */
  name: string;
  /** Shown alone on the prev/next buttons, which name the surname because the
   *  list is ordered by surname. Falls back to `name` when empty. */
  lastName: string;
  /** Added 2026-09-27 -- opened from Student Records (no ?context=), the nav
   *  instead sorts grade > section > gender > surname > first name, matching
   *  that module's own table order (PatientList.tsx), not plain alphabetical. */
  firstName: string;
  gender: string;
  grade: string;
  section: string;
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
        // Cached across mounts within the session (user, 2026-09-27) -- same
        // decrypt-heavy Student.find() as /stats/student-rows, and this nav
        // remounts on every Dental Chart open/Prev/Next. useStudents.ts's
        // `reload` invalidates this cache entry too, on any mutation.
        const rows = await cachedGet(STUDENT_NAV_CACHE_KEY, () => apiClient.get<StudentNavEntry[]>(STUDENT_NAV_CACHE_KEY));
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
