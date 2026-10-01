// Surname-first display, matching the DOH IPTR paper form and how the clinic
// reads its lists. Built from the STUDENT name parts (added Sprint 35) — never
// by splitting full_name in the UI, which mis-handles multi-word surnames
// (De Guzman, Dela Cruz) and suffixes (Jr., III).
//
// ⚠ MOVED HERE FROM `src/app/utils` IN SPRINT 139, because the server had
// hand-copied these fallbacks twice — `/stats/student-nav` and
// `/stats/student-rows` — and both carried a comment saying a drift here
// reorders the prev/next patient navigation. Three copies of a sort key is
// how two screens end up disagreeing about who comes next.

export type NameParts = { last_name?: string; first_name?: string; middle_name?: string; full_name?: string };

/** "Morales, Juan" — the canonical list/record heading. */
export const surnameFirst = (s: NameParts): string => {
  const last = (s.last_name ?? '').trim();
  const first = (s.first_name ?? '').trim();
  if (!last && !first) return (s.full_name ?? '').trim();
  if (!last) return first;
  if (!first) return last;
  return `${last}, ${first}`;
};

/** "Morales, Juan P." — adds the middle initial where one exists. */
export const surnameFirstWithInitial = (s: NameParts): string => {
  const base = surnameFirst(s);
  const middle = (s.middle_name ?? '').trim();
  if (!middle || !base.includes(',')) return base;
  return `${base} ${middle.charAt(0).toUpperCase()}.`;
};

/** Surname alone — for the chart's cramped prev/next buttons. */
export const surnameOnly = (s: NameParts): string => {
  const last = (s.last_name ?? '').trim();
  if (last) return last;
  // Pre-migration fallback only: last whitespace-separated token.
  const full = (s.full_name ?? '').trim();
  return full ? full.split(/\s+/).pop() ?? full : '';
};
