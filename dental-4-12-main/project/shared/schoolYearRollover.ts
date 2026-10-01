// ─── Rules for starting a school year, shared by server and client ──────────
//
// 2026-10-01, Update School Year redesign. The System Admin starts the NEXT
// school year for every school at once; a dentist or dental aide may ask, ONCE
// A YEAR, for their own school to start early, and the System Admin approves or
// declines. These are the pure rules; the data lives in SCHOOL_YEAR_ROLLOVER.
//
// Nothing here may import mongoose or React.

import { schoolYearEnd } from './schoolYear.js';

export type RolloverStatus = 'not_started' | 'requested' | 'declined' | 'started';

/** First year of a "2027-2028" label, or NaN. */
export const startYearOf = (sy: string): number => Number(String(sy).split('-')[0]);

/** True when `sy` is a later school year than `current` ("2027-2028" > "2026-2027"). */
export function isLaterSchoolYear(sy: string, current: string): boolean {
  const a = startYearOf(sy);
  const b = startYearOf(current);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/**
 * Why `ymd` ("YYYY-MM-DD") cannot be the planned start of the next school year,
 * or null when it can. "Next year only" (user, 2026-10-01): the date must fall
 * after the school year now running ends (April 30) and before the next
 * calendar year, so it cannot be set two years ahead or inside the year that is
 * still in progress.
 */
export function plannedStartProblem(ymd: unknown, now: Date = new Date()): string | null {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Choose a valid date.';
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return 'Choose a valid date.';
  const earliest = new Date(schoolYearEnd(now).getTime() + 1);
  earliest.setHours(0, 0, 0, 0);
  const lastDay = new Date(earliest.getFullYear(), 11, 31);
  if (date < earliest) {
    return `The next school year cannot start before ${earliest.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}, when the current one ends.`;
  }
  if (date > lastDay) return 'The start date can only be set for the next school year.';
  return null;
}

/** What a school's rollover row means to the screen. */
export function rolloverStatus(row: { status?: string } | null | undefined): RolloverStatus {
  if (!row) return 'not_started';
  if (row.status === 'started') return 'started';
  if (row.status === 'requested') return 'requested';
  if (row.status === 'declined') return 'declined';
  return 'not_started';
}

/** A school may ask once per school year: only when it has no row of its own. */
export const canRequestEarlyStart = (status: RolloverStatus): boolean => status === 'not_started';

/**
 * Nobody, System Admin included, may start a school year before the calendar
 * year it begins in (user, 2026-10-01): "2027-2028" opens on 1 January 2027.
 * Returns why it cannot be started yet, or null when it can.
 */
export function startLockedReason(sy: string, now: Date = new Date()): string | null {
  const y = startYearOf(sy);
  if (!Number.isFinite(y) || now >= new Date(y, 0, 1)) return null;
  return `${sy} can only be started from January 1, ${y}.`;
}
