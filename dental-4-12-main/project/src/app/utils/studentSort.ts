const GRADES = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];

/** Default Students list order (user, 2026-10-05): alphabetical by surname, then
 *  first name; students with the same name are ordered by grade (Kinder first,
 *  then Grade 1 to 10 in number order, no grade last) and then section. Shared
 *  with the dental chart's Prev/Next so the two walk the list the same way. */
export const compareStudentsDefault = (
  a: { lastName?: string; firstName?: string; name: string; grade: string; section: string },
  b: { lastName?: string; firstName?: string; name: string; grade: string; section: string },
) => {
  const rank = (g: string) => { const i = GRADES.indexOf(g); return i === -1 ? GRADES.length : i; };
  return (
    (a.lastName || a.name).localeCompare(b.lastName || b.name, undefined, { sensitivity: 'base' }) ||
    (a.firstName ?? '').localeCompare(b.firstName ?? '', undefined, { sensitivity: 'base' }) ||
    rank(a.grade) - rank(b.grade) ||
    a.section.localeCompare(b.section, undefined, { sensitivity: 'base' })
  );
};
