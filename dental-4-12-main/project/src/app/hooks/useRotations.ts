import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import type { ApiDentist, ApiDentistRotation } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { toLocalDateString } from '../utils/localDate';

// ─── School Rotation (2026-09-24) ────────────────────────────────────────────
// Where the dentist is on a given day. One DENTIST_ROTATION row per day
// (week_start = week_end = that day, local midnight). Dates are keyed by LOCAL
// "YYYY-MM-DD" everywhere so a day never slips across the UTC boundary.

export const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of the week containing `d`. */
export const mondayOf = (d: Date) => addDays(dayStart(d), -((d.getDay() + 6) % 7));

/** Which dentist the rotation is about: the signed-in dentist's own record;
 *  for everyone else (aide, admin) the clinic's dentist, or the chosen one
 *  when there is more than one. */
export function useRotationDentist(enabled = true) {
  const { user } = useAuth();
  const [dentists, setDentists] = useState<ApiDentist[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    apiClient.get<ApiDentist[]>('/dentists').then(setDentists).catch(() => setDentists([]));
  }, [enabled]);
  const own = dentists.find((d) => d.user_id === user?.id) ?? null;
  const dentist = own ?? dentists.find((d) => d._id === chosenId) ?? dentists[0] ?? null;
  return { dentist, dentists, isOwn: !!own, setChosenId };
}

/** Rotation rows whose day falls in [from, to] (both inclusive, local days). */
export function useRotations(from: Date, to: Date, dentistId: string | null | undefined) {
  const [rows, setRows] = useState<ApiDentistRotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fromKey = toLocalDateString(from);
  const toKey = toLocalDateString(to);
  const reload = useCallback(async () => {
    if (!dentistId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [fy, fm, fd] = fromKey.split('-').map(Number);
      const [ty, tm, td] = toKey.split('-').map(Number);
      const qFrom = new Date(fy, fm - 1, fd).toISOString();
      const qTo = new Date(ty, tm - 1, td, 23, 59, 59, 999).toISOString();
      setRows(await apiClient.get<ApiDentistRotation[]>(
        `/dentist-rotations?from=${encodeURIComponent(qFrom)}&to=${encodeURIComponent(qTo)}&dentist_id=${dentistId}`,
      ));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the rotation');
    } finally {
      setLoading(false);
    }
  }, [fromKey, toKey, dentistId]);
  useEffect(() => { void reload(); }, [reload]);
  const byDay = useMemo(() => rotationByDay(rows), [rows]);
  return { rows, byDay, loading, error, reload };
}

/** Local "YYYY-MM-DD" → the row covering that day. A single-day row wins over
 *  an older multi-day (weekly) row that also spans the day, so re-setting one
 *  day of a legacy week behaves as expected. */
export function rotationByDay(rows: ApiDentistRotation[]): Map<string, ApiDentistRotation> {
  const map = new Map<string, ApiDentistRotation>();
  const span = (r: ApiDentistRotation) => new Date(r.week_end).getTime() - new Date(r.week_start).getTime();
  // Widest first, so narrower (single-day) rows overwrite them.
  for (const r of [...rows].sort((a, b) => span(b) - span(a))) {
    const start = dayStart(new Date(r.week_start));
    const end = dayStart(new Date(r.week_end));
    for (let d = start; d <= end; d = addDays(d, 1)) map.set(toLocalDateString(d), r);
  }
  return map;
}
