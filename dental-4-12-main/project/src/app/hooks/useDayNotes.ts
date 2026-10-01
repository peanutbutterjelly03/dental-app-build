import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { toLocalDateString } from '../utils/localDate';

/** A note written against a DATE rather than a patient (Sprint 108).
 *  `school_id: null` means every school — a barangay-wide holiday. */
export interface ApiDayNote {
  _id: string;
  date: string;
  school_id: string | null;
  note: string;
  created_by: string | null;
  isArchived: boolean;
}

/**
 * Day notes for the month the calendar is showing.
 *
 * ⚠ BOUNDED BY MONTH, deliberately. `/day-notes` declares `dateField: "date"`,
 * so this asks for a range rather than the collection — the same treatment
 * Sprint 56 gave appointments. A year of holidays would otherwise quietly
 * become another unbounded read (Open work #24).
 */
export function useDayNotes(monthDate: Date) {
  const [notes, setNotes] = useState<ApiDayNote[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Whole-month window, padded by a day at each end so a note written near a
  // boundary in another timezone still lands in the month the user is looking at.
  const from = new Date(monthDate.getFullYear(), monthDate.getMonth(), 0);
  const to = new Date(monthDate.getFullYear(), monthDate.getMonth() + 2, 1);
  const fromKey = toLocalDateString(from);
  const toKey = toLocalDateString(to);

  const reload = useCallback(async () => {
    try {
      const rows = await apiClient.get<ApiDayNote[]>(`/day-notes?from=${fromKey}&to=${toKey}`);
      setNotes(rows);
      setError(null);
    } catch (err) {
      setNotes([]);
      setError(err instanceof Error ? err.message : 'Failed to load day notes');
    }
  }, [fromKey, toKey]);

  useEffect(() => { void reload(); }, [reload]);

  /** Notes on one calendar square, newest first. */
  const notesFor = useCallback(
    (date: Date | null) => {
      if (!date) return [];
      const key = toLocalDateString(date);
      return notes.filter((n) => toLocalDateString(new Date(n.date)) === key);
    },
    [notes],
  );

  return { notes, notesFor, reload, error };
}
