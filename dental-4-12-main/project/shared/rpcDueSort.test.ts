import { describe, it, expect } from 'vitest';
import { filterRpcRows, type RPCRow } from './rpcTracking';

const row = (name: string, visit1Date: string | null, visit2Date: string | null) => ({
  id: name, studentName: name, birthdate: '2015-01-01', gender: 'Male', school: 'BTIS', grade: 'Grade 3', section: 'Rose',
  visit1Date, visit1Status: visit1Date ? 'Completed' : 'Pending', visit2Date, visit2Status: visit2Date ? 'Completed' : 'Pending',
  daysUntilDue: 0, status: 'pending', earlyVisit2: false, syCutoff: null, syDeadline: null,
  treatmentCodes: [], treatmentCounts: {}, iptrIdBySchoolYear: {},
}) as unknown as RPCRow;

describe("sort 'due_asc'", () => {
  it('puts the nearest due date first, overdue before upcoming, rows with no due date last', () => {
    const rows = [
      row('Aa Done', '2026-01-01', '2026-05-01'),
      row('Bb Later', '2026-09-28', null),
      row('Cc Early', '2026-05-01', null),
      row('Dd Soon', '2026-06-01', null),
      row('Ee None', null, null),
    ];
    const names = filterRpcRows(rows, { status: 'all', sort: 'due_asc' }).rows.map((r) => r.studentName);
    expect(names).toEqual(['Cc Early', 'Dd Soon', 'Bb Later', 'Aa Done', 'Ee None']);
  });
});
