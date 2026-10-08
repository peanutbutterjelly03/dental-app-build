import { describe, it, expect } from 'vitest';
import { buildFhsisCounts } from './fhsis';

// One school child, aged 8, with a first visit in each of Jan, Apr and Oct 2026.
const base = {
  students: [{ _id: 's1', school_id: 'sc1', sex: 'Male', birthday: '2018-01-01T00:00:00.000Z' }],
  iptrs: [{ _id: 'i1', student_id: 's1' }],
  pcrs: ['2026-01-15', '2026-04-15', '2026-10-15'].map((d) => ({
    iptr_id: 'i1', visit_date: `${d}T00:00:00.000Z`, visit_number: 1, facility_based: null,
  })),
  schools: [{ _id: 'sc1', school_name: 'A' }],
  schoolName: '',
};
const firstVisits = (month: string) => {
  const { counts } = buildFhsisCounts({ ...base, month });
  return Object.values(counts).reduce((n, b) => n + b.first.male + b.first.female, 0);
};

describe('buildFhsisCounts period', () => {
  it('counts one month', () => expect(firstVisits('2026-10')).toBe(1));
  it('sums a quarter from its months', () => expect(firstVisits('2026-04..2026-06')).toBe(1));
  it('sums a half year', () => expect(firstVisits('2026-01..2026-06')).toBe(2));
  it('sums a whole year', () => expect(firstVisits('2026-01..2026-12')).toBe(3));
  it('counts nothing for an empty period', () => expect(firstVisits('')).toBe(0));
});
