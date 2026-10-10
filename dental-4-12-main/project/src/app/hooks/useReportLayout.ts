import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { emptyLayout, type ReportKey, type ReportLayout } from '../../../shared/reportLayout';

interface StoredLayout extends ReportLayout { _id: string }

/** Who may change a report table's layout. Everyone who can open reports reads it. */
const EDIT_ROLES = ['system_admin', 'dentist', 'dental_aide'];

/**
 * The saved layout of one report table (hidden columns, added rows and columns,
 * renamed labels, text typed into added cells) and the way to change it.
 *
 * Saves are SERIALISED: two quick edits must not both try to create the
 * document, so each write waits for the one before it and reads the latest
 * layout when its turn comes. The screen updates at once (the next layout is
 * set before the request), and a failed save is reported, never swallowed.
 */
export function useReportLayout(reportKey: ReportKey) {
  const { user } = useAuth();
  const canEdit = !!user && EDIT_ROLES.includes(user.role);
  const [layout, setLayout] = useState<ReportLayout>(() => emptyLayout(reportKey));
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(layout);
  const idRef = useRef<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const pick = (doc: StoredLayout): ReportLayout => ({
    report_key: reportKey,
    hidden_cols: doc.hidden_cols ?? [],
    added_cols: doc.added_cols ?? [],
    added_rows: doc.added_rows ?? [],
    labels: doc.labels ?? [],
    cells: doc.cells ?? [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiClient.get<StoredLayout[]>(`/report-layouts?report_key=${reportKey}`);
        if (cancelled) return;
        const doc = rows[0];
        if (doc) {
          idRef.current = doc._id;
          latest.current = pick(doc);
          setLayout(latest.current);
        }
      } catch {
        // A layout that cannot load leaves the table as the form defines it.
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  const persist = async () => {
    const body = latest.current;
    if (idRef.current) {
      await apiClient.put(`/report-layouts/${idRef.current}`, body);
      return;
    }
    try {
      const created = await apiClient.post<StoredLayout>('/report-layouts', body);
      idRef.current = created._id;
    } catch (err) {
      // Someone else created it a moment ago: take their id and write over it.
      const rows = await apiClient.get<StoredLayout[]>(`/report-layouts?report_key=${reportKey}`);
      if (!rows[0]) throw err;
      idRef.current = rows[0]._id;
      await apiClient.put(`/report-layouts/${rows[0]._id}`, body);
    }
  };

  /** Change the layout: `change` gets the newest layout and returns the next one. */
  const update = useCallback((change: (l: ReportLayout) => ReportLayout) => {
    if (!canEdit) return;
    const next = change(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setLayout(next);
    setError(null);
    chain.current = chain.current.then(persist).catch((err) => {
      setError(err instanceof Error ? err.message : 'The layout could not be saved.');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, reportKey]);

  return { layout, update, canEdit, error };
}

export type ReportLayoutApi = ReturnType<typeof useReportLayout>;
