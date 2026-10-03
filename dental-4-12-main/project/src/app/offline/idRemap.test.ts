import { describe, it, expect } from 'vitest';
import { pendingRowIdsIn, replacePendingId, hasUnresolvedPending } from './idRemap';

describe('pendingRowIdsIn', () => {
  it('finds placeholders in endpoint strings, nested bodies and arrays', () => {
    expect(pendingRowIdsIn('/students/pending-7/archive')).toEqual([7]);
    expect(pendingRowIdsIn({ student_id: 'pending-3', nested: { chart: ['pending-9'] } }).sort()).toEqual([3, 9]);
  });
  it('finds nothing in real ids, numbers or null', () => {
    expect(pendingRowIdsIn({ a: '64b5f0c2a1b2c3d4e5f60718', b: 12, c: null })).toEqual([]);
  });
});

describe('replacePendingId', () => {
  it('replaces the exact placeholder everywhere', () => {
    const out = replacePendingId({ student_id: 'pending-7', tags: ['pending-7'] }, 7, 'REAL');
    expect(out).toEqual({ student_id: 'REAL', tags: ['REAL'] });
    expect(replacePendingId('/student-iptrs/pending-7', 7, 'REAL')).toBe('/student-iptrs/REAL');
  });
  it('does not touch a longer id that merely starts with the same digits', () => {
    expect(replacePendingId({ a: 'pending-71', b: 'pending-7' }, 7, 'REAL')).toEqual({ a: 'pending-71', b: 'REAL' });
  });
  it('leaves other placeholders and non-string values alone, and does not mutate the input', () => {
    const input = { a: 'pending-8', n: 5, f: true, z: null };
    const out = replacePendingId(input, 7, 'REAL');
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

describe('hasUnresolvedPending', () => {
  it('is true while a placeholder remains in the endpoint or body', () => {
    expect(hasUnresolvedPending({ endpoint: '/tooth-records', body: { chart_id: 'pending-4' } })).toBe(true);
    expect(hasUnresolvedPending({ endpoint: '/students/pending-4', body: {} })).toBe(true);
  });
  it('is false once everything is a real id', () => {
    expect(hasUnresolvedPending({ endpoint: '/tooth-records', body: { chart_id: '64b5f0c2a1b2c3d4e5f60718' } })).toBe(false);
  });
});
