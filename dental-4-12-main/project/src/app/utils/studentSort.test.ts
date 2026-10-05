import { describe, it, expect } from 'vitest';
import { compareStudentsDefault } from './studentSort';

const r = (name: string, grade = '', section = '', isNotStudent = false) => ({ name, grade, section, isNotStudent });

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
});
