import { describe, it, expect } from 'vitest';
import { compareStudentsDefault } from './studentSort';

const r = (name: string, grade = '', section = '', isNotStudent = false, gender = '') => ({ name, grade, section, isNotStudent, gender });

describe('compareStudentsDefault', () => {
  it('orders placed students by grade, then unassigned students, then non-students, each A to Z', () => {
    const rows = [
      r('Zed', '', '', true), r('Ann', '', '', true), r('Yan'), r('Bea'),
      r('Cruz', 'Grade 2', 'B'), r('Abad', 'Kinder', 'A'), r('Dela', 'Grade 2', 'A'), r('Half', 'Grade 1', ''),
    ];
    expect([...rows].sort(compareStudentsDefault).map((x) => x.name)).toEqual(
      ['Abad', 'Dela', 'Cruz', 'Bea', 'Half', 'Yan', 'Ann', 'Zed'],
    );
  });

  it('within a grade and section, lists male students before female students, then A to Z', () => {
    const rows = [
      r('Bea', 'Grade 1', 'A', false, 'Female'), r('Zed', 'Grade 1', 'A', false, 'Male'),
      r('Ann', 'Grade 1', 'A', false, 'Female'), r('Cruz', 'Grade 1', 'A', false, 'Male'),
      r('Yan', 'Grade 1', 'B', false, 'Male'),
    ];
    expect([...rows].sort(compareStudentsDefault).map((x) => x.name)).toEqual(['Cruz', 'Zed', 'Ann', 'Bea', 'Yan']);
  });
});
