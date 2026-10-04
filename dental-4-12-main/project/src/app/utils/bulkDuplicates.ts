// Bulk import duplicate detection, the in-file half (2026-10-04). The server's
// /students/duplicate-check answers "already on file?"; this answers "does the
// same child appear twice in THIS upload?". Same key as the server's
// findDuplicateStudents (server/utils/studentDuplicates.ts): school + birthday
// (calendar day) + last and first name, accents folded, case and spacing
// ignored. Middle name and sex are deliberately not part of it, as there.

/** A choice made on the bulk review list, by row index: 'skip' = same child,
 *  do not save; 'different' = another child, save without asking again. */
export type DupDecisions = Record<number, 'skip' | 'different'>;

export interface DupKeyFields {
  school: string;
  birthdate: string;
  lastName: string;
  firstName: string;
}

export function normalizeDupName(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** null when the row lacks a field the rule needs (it cannot be matched). */
export function dupKey(p: DupKeyFields): string | null {
  const last = normalizeDupName(p.lastName ?? '');
  const first = normalizeDupName(p.firstName ?? '');
  const day = (p.birthdate ?? '').slice(0, 10);
  if (!p.school || !day || !last || !first) return null;
  return [p.school, day, last, first].join('|');
}

/** For each row index, the OTHER indices in the same upload that look like the same child. */
export function inFileDuplicates(rows: (DupKeyFields | null)[]): Map<number, number[]> {
  const byKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = r ? dupKey(r) : null;
    if (!k) return;
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  const out = new Map<number, number[]>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const i of group) out.set(i, group.filter((j) => j !== i));
  }
  return out;
}
