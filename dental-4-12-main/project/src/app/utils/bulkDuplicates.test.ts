import { describe, it, expect } from 'vitest';
import { inFileDuplicates, dupKey } from './bulkDuplicates';

const p = (lastName: string, firstName: string, birthdate = '2015-03-05', school = 'BTIS') => ({ school, birthdate, lastName, firstName });

describe('bulk import: same child twice in one upload', () => {
  it('matches on school + birthday + names, ignoring case, spacing and accents', () => {
    const m = inFileDuplicates([p('Peña', 'Ana'), p('Cruz', 'Ben'), p(' pena ', 'ANA')]);
    expect(m.get(0)).toEqual([2]);
    expect(m.get(2)).toEqual([0]);
    expect(m.has(1)).toBe(false);
  });

  it('a different birthday or school is a different child', () => {
    expect(inFileDuplicates([p('Cruz', 'Ben'), p('Cruz', 'Ben', '2015-03-06')]).size).toBe(0);
    expect(inFileDuplicates([p('Cruz', 'Ben'), p('Cruz', 'Ben', '2015-03-05', 'Annex A')]).size).toBe(0);
  });

  it('a row missing a key field is never matched (and unreadable rows are null)', () => {
    expect(dupKey(p('Cruz', ''))).toBeNull();
    expect(inFileDuplicates([p('Cruz', ''), p('Cruz', ''), null]).size).toBe(0);
  });

  it('three copies: each lists the other two', () => {
    expect(inFileDuplicates([p('Cruz', 'Ben'), p('Cruz', 'Ben'), p('Cruz', 'Ben')]).get(1)).toEqual([0, 2]);
  });
});
