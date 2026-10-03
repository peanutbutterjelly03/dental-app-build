// Formats a Date using LOCAL time components (not UTC) as "YYYY-MM-DD" /
// "HH:MM". Appointment day/time bucketing should always use the clinic's
// local time, not UTC — an 8am PH appointment should show on today's date
// regardless of what UTC calendar day that instant falls on. Using
// toISOString() (UTC) for this instead caused appointments near midnight to
// silently vanish from the calendar grid (correct day-tile, wrong date
// string to match against) — see HANDOFF.md's Sprint 20 notes.
export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function toLocalTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Display formatting — the house format is "Aug 27, 2026".
//
// These exist because every screen used to format inline, across FOUR
// different locales ('en-PH', 'en-US', 'en-GB' and the browser default), so
// the same date rendered as "27 Aug 2026", "Aug 27, 2026" and "Wednesday,
// 27 August 2026" depending on which screen you were looking at. 'en-US' is
// pinned deliberately: letting the browser locale decide is exactly what
// produced that drift, and the format is a house decision, not a user
// preference. Month-only labels (chart axes, month navigation, report
// periods) are NOT dates and deliberately don't go through here.
// ---------------------------------------------------------------------------

const LOCALE = 'en-US';
const DATE_OPTS = { month: 'short', day: 'numeric', year: 'numeric' } as const;

// A bare "YYYY-MM-DD" is parsed by Date as UTC midnight, which renders as the
// PREVIOUS day in any timezone behind UTC. Pinning it to local midnight keeps
// a stored calendar date displaying as that same calendar date everywhere —
// the same off-by-one class of bug as the Sprint 20 note above.
function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Aug 27, 2026" — the default for any date shown to a user. */
export function formatDate(value: Date | string | number | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? d.toLocaleDateString(LOCALE, DATE_OPTS) : fallback;
}

/** "Wed, Aug 27, 2026" — for the dashboard/appointments "today" headers, where staff schedule by day of week. */
export function formatDateWithWeekday(value: Date | string | number | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? d.toLocaleDateString(LOCALE, { weekday: 'short', ...DATE_OPTS }) : fallback;
}

/** "Aug 27, 2026, 3:04 PM" — for audit timestamps, where the time matters. */
export function formatDateTime(value: Date | string | number | null | undefined, fallback = '—'): string {
  const d = asDate(value);
  return d ? d.toLocaleString(LOCALE, { ...DATE_OPTS, hour: 'numeric', minute: '2-digit' }) : fallback;
}
