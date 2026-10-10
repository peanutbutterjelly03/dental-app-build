// The DOH report's Time period / Dates filter: a record is counted when its
// FIRST recorded visit falls inside the inclusive range.

import { describe, it, expect } from 'vitest';
import { aggregateDohReport, GRADE_ALL, type DohAggregateInput } from './dohAggregate';

const base = (visitDate: string | null): DohAggregateInput => ({
  schools: [{ _id: 's1', school_name: 'Test School' }],
  students: [{ _id: 'st1', school_id: 's1', sex: 'Male', birthday: '2014-03-01' }],
  iptrs: [{ _id: 'i1', student_id: 'st1', school_year: '2026-2027', grade_level: 'Grade 6' }],
  medicals: [], dietaries: [],
  orals: [{ iptr_id: 'i1' } as DohAggregateInput['orals'][number]],
  preventives: visitDate ? [{ _id: 'p1', iptr_id: 'i1', visit_number: 1, visit_date: visitDate } as DohAggregateInput['preventives'][number]] : [],
  risks: [], charts: [], toothRecords: [], referrals: [],
  schoolYear: null, schoolName: null,
});
const attended = (r: ReturnType<typeof aggregateDohReport>) =>
  Object.entries(r.counts).filter(([k]) => k.startsWith(`${GRADE_ALL}|`) && k.endsWith('|attended')).reduce((n, [, v]) => n + v, 0);

describe('DOH report date range', () => {
  it('counts a record whose first visit is inside the range, bounds inclusive', () => {
    expect(attended(aggregateDohReport({ ...base('2026-10-31'), dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(1);
    expect(attended(aggregateDohReport({ ...base('2026-10-01'), dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(1);
  });
  it('leaves out a record whose first visit is outside the range', () => {
    expect(attended(aggregateDohReport({ ...base('2026-09-30'), dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(0);
  });
  it('leaves out a record with no visit date when a range is set, but not when none is', () => {
    expect(attended(aggregateDohReport({ ...base(null), dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(0);
    expect(attended(aggregateDohReport(base(null)))).toBe(1);
  });
});
