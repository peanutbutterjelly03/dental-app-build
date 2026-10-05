import type { ApiSchool } from '../api/types';

/** Grade levels a school can start or end at, in the app's own wording. */
export const SCHOOL_GRADES = ['Kinder', ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];

/** Grade range of a school. Schools registered before grade_from / grade_to
 *  existed only carry a school_type such as "Integrated (K-Grade 10)", so the
 *  range is read back out of that text rather than shown blank. */
export const schoolGradeRange = (s: Pick<ApiSchool, 'grade_from' | 'grade_to' | 'school_type'>) => {
  if (s.grade_from && s.grade_to) return { from: s.grade_from, to: s.grade_to };
  const m = /K-Grade (\d+)/i.exec(s.school_type ?? '');
  return m ? { from: 'Kinder', to: `Grade ${m[1]}` } : { from: '', to: '' };
};

export const schoolGradeLabel = (s: Pick<ApiSchool, 'grade_from' | 'grade_to' | 'school_type'>) => {
  const { from, to } = schoolGradeRange(s);
  return from && to ? `${from} to ${to}` : '';
};
