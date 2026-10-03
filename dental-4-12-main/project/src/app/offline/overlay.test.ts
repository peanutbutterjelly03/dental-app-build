import { describe, it, expect } from 'vitest';
import { applyPendingWrites, parsePath, type PendingRow } from './overlay';

const IPTR = '64b5f0c2a1b2c3d4e5f60718';
const T1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const row = (id: number, method: string, endpoint: string, body?: unknown): PendingRow => ({ id, method, endpoint, body });

describe('parsePath', () => {
  it('reads lists with filters, single records, and ignores shaping params', () => {
    expect(parsePath('/tooth-records?chart_id=a,b&limit=5')).toEqual({ kind: 'list', resource: 'tooth-records', filters: { chart_id: ['a', 'b'] } });
    expect(parsePath(`/students/${IPTR}`)).toEqual({ kind: 'single', resource: 'students', id: IPTR });
    expect(parsePath('/students/pending-7')).toEqual({ kind: 'single', resource: 'students', id: 'pending-7' });
    expect(parsePath('/students/duplicates?x=1')).toBeNull();
  });
});

describe('applyPendingWrites: lists', () => {
  it('adds a record created offline, but only to lists whose filter it satisfies', () => {
    const queue = [row(3, 'POST', '/tooth-records', { chart_id: 'C1', tooth_number: 11 })];
    const mine = applyPendingWrites('/tooth-records?chart_id=C1', [], queue) as Record<string, unknown>[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ _id: 'pending-3', tooth_number: 11, _pending: true, isArchived: false });
    expect(applyPendingWrites('/tooth-records?chart_id=C2', [], queue)).toEqual([]);
  });
  it('treats a missing base as an empty list (a record that only exists on this device)', () => {
    const queue = [row(1, 'POST', '/student-iptrs', { student_id: 'pending-9' })];
    expect(applyPendingWrites('/student-iptrs?student_id=pending-9', undefined, queue)).toHaveLength(1);
  });
  it('applies an offline edit to the matching cached record and leaves the rest', () => {
    const base = [{ _id: T1, tooth_number: 11, condition: 'Caries' }, { _id: 'b'.repeat(24), tooth_number: 12, condition: 'Sound' }];
    const out = applyPendingWrites('/tooth-records?chart_id=C1', base, [row(5, 'PUT', `/tooth-records/${T1}`, { condition: 'Filled' })]) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ condition: 'Filled', tooth_number: 11, _pending: true });
    expect(out[1]).toEqual(base[1]);
  });
  it('removes a record archived offline', () => {
    const base = [{ _id: T1 }, { _id: 'b'.repeat(24) }];
    expect(applyPendingWrites('/tooth-records?chart_id=C1', base, [row(2, 'PATCH', `/tooth-records/${T1}/archive`)])).toEqual([{ _id: 'b'.repeat(24) }]);
  });
  it('applies a create then an edit of that same new record, in order', () => {
    const queue = [row(4, 'POST', '/tooth-records', { chart_id: 'C1', condition: 'Caries' }), row(6, 'PUT', '/tooth-records/pending-4', { condition: 'Filled' })];
    const out = applyPendingWrites('/tooth-records?chart_id=C1', [], queue) as Record<string, unknown>[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ _id: 'pending-4', condition: 'Filled' });
  });
  it('does not touch the cache entry it was given', () => {
    const base = [{ _id: T1, condition: 'Caries' }];
    applyPendingWrites('/tooth-records?chart_id=C1', base, [row(5, 'PUT', `/tooth-records/${T1}`, { condition: 'Filled' })]);
    expect(base[0].condition).toBe('Caries');
  });
});

describe('applyPendingWrites: single records', () => {
  it('builds a record that only exists on this device from its queued create', () => {
    const out = applyPendingWrites('/students/pending-7', undefined, [row(7, 'POST', '/students', { last_name: 'Cruz' })]);
    expect(out).toMatchObject({ _id: 'pending-7', last_name: 'Cruz', _pending: true });
  });
  it('merges an offline edit onto the cached record', () => {
    const out = applyPendingWrites(`/students/${T1}`, { _id: T1, last_name: 'Cruz', section: 'A' }, [row(2, 'PUT', `/students/${T1}`, { section: 'B' })]);
    expect(out).toMatchObject({ last_name: 'Cruz', section: 'B', _pending: true });
  });
  it('returns undefined for an unknown record, so the caller can fail honestly', () => {
    expect(applyPendingWrites('/students/pending-8', undefined, [row(7, 'POST', '/students', {})])).toBeUndefined();
  });
});

describe('applyPendingWrites: scope', () => {
  it('leaves other resources and stats alone (they merge their own pending rows)', () => {
    const queue = [row(1, 'POST', '/appointments', { x: 1 })];
    expect(applyPendingWrites('/appointments', [], queue)).toEqual([]);
    expect(applyPendingWrites('/stats/student-rows', [{ id: 1 }], [row(1, 'POST', '/students', {})])).toEqual([{ id: 1 }]);
  });
  it('returns the data untouched when nothing is queued for that resource', () => {
    const base = [{ _id: T1 }];
    expect(applyPendingWrites('/students', base, [])).toBe(base);
  });
});
