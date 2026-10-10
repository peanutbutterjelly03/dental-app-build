// Grade and Section narrow the School Summary to students whose IPTR for the
// year carries that grade / section; a student with no matching IPTR is left
// out entirely, and `sections` lists what exists before the filter.

import { describe, it, expect } from 'vitest';
import { buildSchoolSummary, type SchoolSummaryInput } from './schoolSummary';

const input = (extra: Partial<SchoolSummaryInput> = {}): SchoolSummaryInput => ({
  schools: [{ _id: 's1', school_name: 'Test School' }],
  students: [
    { _id: 'a', school_id: 's1', sex: 'Male' },
    { _id: 'b', school_id: 's1', sex: 'Female' },
    { _id: 'c', school_id: 's1', sex: 'Female' },
  ],
  iptrs: [
    { _id: 'ia', student_id: 'a', school_year: '2026-2027', grade_level: 'Grade 1', section: 'A' },
    { _id: 'ib', student_id: 'b', school_year: '2026-2027', grade_level: 'Grade 1', section: 'B' },
    { _id: 'ic', student_id: 'c', school_year: '2026-2027', grade_level: 'Grade 2', section: 'A' },
  ],
  orals: [], charts: [], toothRecords: [],
  schoolName: null, schoolYear: '2026-2027',
  ...extra,
});

describe('School Summary grade and section filters', () => {
  it('counts everyone with no filter', () => {
    const t = buildSchoolSummary(input()).tally.students;
    expect(t.Male + t.Female).toBe(3);
  });
  it('narrows by grade', () => {
    const t = buildSchoolSummary(input({ grade: 'Grade 1' })).tally.students;
    expect(t.Male + t.Female).toBe(2);
  });
  it('narrows by grade and section together', () => {
    const t = buildSchoolSummary(input({ grade: 'Grade 1', section: 'B' })).tally.students;
    expect(t.Male).toBe(0);
    expect(t.Female).toBe(1);
  });
  it('lists the sections that exist, regardless of the filter', () => {
    expect(buildSchoolSummary(input({ grade: 'Grade 2' })).sections).toEqual(['A', 'B']);
  });
});
