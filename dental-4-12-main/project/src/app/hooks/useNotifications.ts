import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';

/** Roles that do clinical work, and so have anything to be notified about.
 *
 *  ⚠ School Administrator and Barangay Health Office staff are deliberately
 *  excluded: per CLAUDE.md they view reports and dashboards, never clinical
 *  records. A bell that is permanently empty is noise, and one that showed them
 *  overdue RPC visits would be showing clinical state to a role that cannot act
 *  on it. The sidebar hides the control for them entirely rather than rendering
 *  a zero. */
export const NOTIFIED_ROLES = ['dentist', 'dental_aide', 'system_admin'];

export interface NotificationCounts {
  /** Visit 1 recorded, visit 2 not, and past the 150-day interval. */
  overdueRpc: number;
  appointmentsToday: number;
  /** Risk assessments the dentist has not validated. */
  awaitingValidation: number;
  /** Calendar reminders/notes (stored as DentistRotation rows) whose date
   *  range covers today. */
  remindersToday: number;
}

const EMPTY: NotificationCounts = { overdueRpc: 0, appointmentsToday: 0, awaitingValidation: 0, remindersToday: 0 };

/**
 * Counts for the sidebar bell.
 *
 * ⚠ ONE SERVER CALL, NOT THE UNDERLYING HOOKS. The three sources live in
 * `useRPCTracking` (six whole collections) and the appointments list; mounting
 * those in the sidebar — which renders on every screen — would multiply the
 * app's largest reads across the whole app. `/stats/notifications` does the
 * join once and returns three integers.
 *
 * Scoped to the school in view, so the count agrees with the school switcher.
 */
export function useNotifications(enabled: boolean, schoolName: string | null) {
  const [counts, setCounts] = useState<NotificationCounts>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) { setCounts(EMPTY); return; }
    setLoading(true);
    try {
      const q = schoolName ? `?school=${encodeURIComponent(schoolName)}` : '';
      setCounts(await apiClient.get<NotificationCounts>(`/stats/notifications${q}`));
      setError(null);
    } catch (err) {
      // A failed badge must not blank the sidebar or shout: it is ambient.
      setError(err instanceof Error ? err.message : 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, [enabled, schoolName]);

  useEffect(() => { void reload(); }, [reload]);

  const total = counts.overdueRpc + counts.appointmentsToday + counts.awaitingValidation + counts.remindersToday;
  return { counts, total, loading, error, reload };
}
