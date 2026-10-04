// Dashboard audit item 1 (2026-10-04): the dashboard counted overdue/pending
// students and built its follow-up list from the delivered PAGE (25 rows by
// default), so a school of more than 25 students was described by its first
// 25 alphabetically. These figures now come from the whole school context.

import { describe, it, expect } from 'vitest';
import { filterRpcRows, type RPCRow } from './rpcTracking';

// 30 students, alphabetical; only the LAST five (past row 25) are overdue.
const row = (i: number, status: RPCRow['status'], daysUntilDue: number) => ({
  id: `s${i}`, studentName: `Student ${String(i).padStart(2, '0')}`, birthdate: '2015-01-01', gender: 'Male',
  school: 'BTIS', grade: 'Grade 3', section: 'Rose', visit1Date: null, visit1Status: 'Completed',
  visit2Date: null, visit2Status: 'Pending', daysUntilDue, status, earlyVisit2: false, syCutoff: null,
  syDeadline: null, treatmentCodes: [], treatmentCounts: {}, iptrIdBySchoolYear: {},
}) as unknown as RPCRow;

const all: RPCRow[] = [
  ...Array.from({ length: 22 }, (_, i) => row(i + 1, 'complete', 0)),
  ...Array.from({ length: 3 }, (_, i) => row(i + 23, 'pending', 90)),
  ...Array.from({ length: 5 }, (_, i) => row(i + 26, 'overdue', -10 * (i + 1))),
];

describe('dashboard RPC figures cover the whole school, not the page', () => {
  const page = filterRpcRows(all, { school: 'BTIS', status: 'all', limit: 25 });

  it('the page itself is still 25 rows', () => {
    expect(page.rows).toHaveLength(25);
    expect(page.rows.some((r) => r.status === 'overdue')).toBe(false);
  });

  it('overdue, pending and the most-overdue days count every student', () => {
    expect(page.funnel.overdue).toBe(5);
    expect(page.funnel.pending).toBe(3);
    expect(page.funnel.mostOverdueDays).toBe(50);
  });

  it('the follow-up list is the most overdue first, at most 6, due within 60 days', () => {
    expect(page.followUps.map((r) => r.daysUntilDue)).toEqual([-50, -40, -30, -20, -10]);
  });

  it('"both visits" needs Visit 1 AND Visit 2, never Visit 2 alone (item 2)', () => {
    const v2only = { ...row(99, 'not-started', 0), visit1Status: 'Pending', visit2Status: 'Completed' } as RPCRow;
    const done = { ...row(98, 'complete', 0), visit1Status: 'Completed', visit2Status: 'Completed' } as RPCRow;
    const f = filterRpcRows([v2only, done], { status: 'all' }).funnel;
    expect(f.both).toBe(1);
    expect(f.both).toBe(f.complete);
    expect(f.both).toBeLessThanOrEqual(f.visit1);
  });

  it('dueSoon counts pending students due within 60 days, beyond the 6-row list (item 14)', () => {
    const soon = Array.from({ length: 8 }, (_, i) => row(40 + i, 'pending', 5 + i));
    const f = filterRpcRows([...all, ...soon], { status: 'all' });
    expect(f.funnel.dueSoon).toBe(8); // the 3 at 90 days are outside the window
    expect(f.followUps).toHaveLength(6);
  });

  it('nothing overdue gives null, not 0 days', () => {
    expect(filterRpcRows(all.slice(0, 22), { status: 'all' }).funnel.mostOverdueDays).toBeNull();
  });
});
