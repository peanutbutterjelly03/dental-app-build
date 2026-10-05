const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

type SortRow = { lastName?: string; firstName?: string; name: string; grade: string; section: string; isNotStudent?: boolean };

/** Default Students list order (user, 2026-10-05), in three tiers: students with a
 *  grade AND section (Kinder first, then Grade 1 to 10, then section), then students
 *  missing either one, then non-students (teachers, staff, others) together at the
 *  very end. Inside every tier: surname, then first name. Shared with the dental
 *  chart's Prev/Next so the two walk the list the same way. */
export const compareStudentsDefault = (a: SortRow, b: SortRow) => {
  const rank = (g: string) => { const i = GRADES.indexOf(g); return i === -1 ? GRADES.length : i; };
  const tier = (r: SortRow) => (r.isNotStudent ? 2 : r.grade && r.section ? 0 : 1);
  const t = tier(a) - tier(b);
  const placed = tier(a) === 0;
  return (
    t ||
    (placed ? rank(a.grade) - rank(b.grade) || a.section.localeCompare(b.section, undefined, { sensitivity: 'base' }) : 0) ||
    (a.lastName || a.name).localeCompare(b.lastName || b.name, undefined, { sensitivity: 'base' }) ||
    (a.firstName ?? '').localeCompare(b.firstName ?? '', undefined, { sensitivity: 'base' })
  );
};
