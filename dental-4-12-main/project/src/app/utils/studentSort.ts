const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

type SortRow = { lastName?: string; firstName?: string; name: string; grade: string; section: string; gender?: string; isNotStudent?: boolean };

/** Default Students list order (user, 2026-10-05), in three tiers: students with a
 *  grade AND section (Kinder first, then Grade 1 to 10, then section), then students
 *  missing either one, then non-students (teachers, staff, others) together at the
 *  very end. Inside every tier: gender (male first, then female), then surname, then
 *  first name; placed students are ordered by grade, section, gender, then name
 *  (user, 2026-10-07). Shared with the dental
 *  chart's Prev/Next so the two walk the list the same way. */
export const compareStudentsDefault = (a: SortRow, b: SortRow) => {
  const rank = (g: string) => { const i = GRADES.indexOf(g); return i === -1 ? GRADES.length : i; };
  const tier = (r: SortRow) => (r.isNotStudent ? 2 : r.grade && r.section ? 0 : 1);
  const sexRank = (g?: string) => { const c = (g ?? '').trim().charAt(0).toUpperCase(); return c === 'M' ? 0 : c === 'F' ? 1 : 2; };
  const t = tier(a) - tier(b);
  const placed = tier(a) === 0;
  return (
    t ||
    (placed ? rank(a.grade) - rank(b.grade) || a.section.localeCompare(b.section, undefined, { sensitivity: 'base' }) : 0) ||
    sexRank(a.gender) - sexRank(b.gender) ||
    (a.lastName || a.name).localeCompare(b.lastName || b.name, undefined, { sensitivity: 'base' }) ||
    (a.firstName ?? '').localeCompare(b.firstName ?? '', undefined, { sensitivity: 'base' })
  );
};
