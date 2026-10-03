import { useCallback, useEffect, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import type { ApiAuditTrail, ApiUser } from '../api/types';

export interface AuditLogRow {
  id: string;
  timestamp: string; // ISO, formatted for display in the component
  user: string;
  action: string;
  module: string; // affected_model, e.g. "Student", "Appointment"
  affectedRecordId: string;
}

/** Default window, in days. The audit trail has no natural boundary the way
 *  appointments have a school year (Sprint 56), so this is a choice: long
 *  enough to cover "what changed recently?", short enough that the read stays
 *  bounded as the collection grows without limit. */
export const AUDIT_WINDOW_DAYS = 90;

export function windowStart(days = AUDIT_WINDOW_DAYS): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Loads the audit trail for a bounded window.
 *
 * ⚠ `from` IS THE CONTRACT WITH THE SCREEN'S DATE FILTER, not just a
 * performance knob. Before Sprint 92 this fetched the ENTIRE collection and
 * the screen filtered it in the browser, so any date the user typed worked.
 * Now that the fetch is bounded, a client-side filter reaching further back
 * than `from` would silently show an empty table — a filter that looks like it
 * works and reports "no logs" for a period that has plenty. So the screen
 * passes its own start date down here and the fetch widens to match.
 *
 * `null` means no lower bound: everything, on request.
 */
export function useAuditTrail(from: Date | null = windowStart()) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  const fromKey = from ? from.toISOString() : null;

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const query = fromKey ? `?from=${encodeURIComponent(fromKey)}` : '';
      const [entries, users] = await Promise.all([
        apiClient.get<ApiAuditTrail[]>(`/audit-trails${query}`),
        apiClient.get<ApiUser[]>('/users'),
      ]);
      const userNameById = new Map(users.map((u) => [u._id, u.full_name]));

      const rows: AuditLogRow[] = entries
        .map((e) => ({
          id: e._id,
          timestamp: e.timestamp,
          user: userNameById.get(e.user_id) ?? 'Unknown User',
          action: e.action,
          module: e.affected_model,
          affectedRecordId: e.affected_record_id,
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      setLogs(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit trail');
    } finally {
      endLoad();
    }
    // fromKey, not `from`: a Date object is a new identity on every render and
    // would refetch in a loop.
  }, [fromKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { logs, loading, error, reload, windowFrom: from };
}
