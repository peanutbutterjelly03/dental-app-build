import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

export interface TreatmentCategoryRow {
  code: string;
  studentIds: string[];
}

interface TreatmentCategoriesResponse {
  rows: TreatmentCategoryRow[];
  /** Every school year with at least one IPTR in this scope, newest first,
   *  plus the current year even if it has none yet. */
  schoolYearOptions: string[];
  schoolYear: string;
}

/** Which students have each of the 10 treatment codes, from REAL structured
 *  data (ToothRecord + PreventiveCareRecord) aggregated server-side -- see
 *  /stats/treatment-categories. Labels/local terms come from the shared
 *  `treatmentCodes` vocabulary (dentalChartCodes.ts); this hook only carries
 *  the id lists.
 *
 *  `schoolYear` is a TEMPORARY validation control (user, 2026-09-27) -- the
 *  page defaults to the current year and only offers other years so the
 *  count can be checked against them; pass nothing to get the current year. */
export function useTreatmentCategories(schoolYear?: string) {
  const [rows, setRows] = useState<TreatmentCategoryRow[]>([]);
  const [schoolYearOptions, setSchoolYearOptions] = useState<string[]>([]);
  const [activeSchoolYear, setActiveSchoolYear] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const query = schoolYear ? `?school_year=${encodeURIComponent(schoolYear)}` : '';
        const data = await apiClient.get<TreatmentCategoriesResponse>(`/stats/treatment-categories${query}`);
        if (!cancelled) {
          setRows(data.rows);
          setSchoolYearOptions(data.schoolYearOptions);
          setActiveSchoolYear(data.schoolYear);
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schoolYear]);

  return { rows, schoolYearOptions, activeSchoolYear, loading };
}
