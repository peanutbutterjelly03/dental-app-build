import { describe, it, expect } from 'vitest';
import { unsyncedWritesFor, CHART_RESOURCES } from './pendingFor';

const IPTR = '64b5f0c2a1b2c3d4e5f60718';
const queue = [
  { endpoint: '/dental-charts', body: { iptr_id: IPTR } },
  { endpoint: '/tooth-records/aaaaaaaaaaaaaaaaaaaaaaaa', body: { chart_id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } },
  { endpoint: '/treatments', body: { iptr_id: IPTR } },
  { endpoint: '/dental-charts', body: { iptr_id: 'other' } },
];

describe('unsyncedWritesFor', () => {
  it('matches by id in the body or the endpoint', () => {
    expect(unsyncedWritesFor(queue, [IPTR])).toHaveLength(2);
    expect(unsyncedWritesFor(queue, ['bbbbbbbbbbbbbbbbbbbbbbbb'])).toHaveLength(1);
    expect(unsyncedWritesFor(queue, ['aaaaaaaaaaaaaaaaaaaaaaaa'])).toHaveLength(1);
  });
  it('can be limited to chart resources, so a pending treatment does not block charting', () => {
    const rows = unsyncedWritesFor(queue, [IPTR], CHART_RESOURCES);
    expect(rows.map((r) => r.endpoint)).toEqual(['/dental-charts']);
  });
  it('returns nothing when there are no ids to look for', () => {
    expect(unsyncedWritesFor(queue, [])).toEqual([]);
    expect(unsyncedWritesFor(queue, [''])).toEqual([]);
  });
});
