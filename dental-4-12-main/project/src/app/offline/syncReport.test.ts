import { describe, it, expect } from 'vitest';
import { groupSyncReport, type SyncReportItem } from './syncReport';

const item = (over: Partial<SyncReportItem>): SyncReportItem =>
  ({ module: 'Dental chart', kind: 'Tooth record added', status: 'synced', ...over });

describe('groupSyncReport', () => {
  it('collapses repeated changes into one counted line, keeping each detail', () => {
    const groups = groupSyncReport([item({ detail: '#11' }), item({ detail: '#12' }), item({ detail: '#13' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual([
      { kind: 'Tooth record added', status: 'synced', count: 3, details: ['#11', '#12', '#13'], reasons: [] },
    ]);
  });
  it('keeps modules in the order they first appeared', () => {
    const groups = groupSyncReport([item({ module: 'Students', kind: 'Student record added' }), item({}), item({ module: 'Students', kind: 'School year record added' })]);
    expect(groups.map((g) => g.module)).toEqual(['Students', 'Dental chart']);
    expect(groups[0].lines.map((l) => l.kind)).toEqual(['Student record added', 'School year record added']);
  });
  it('never merges a failure into the synced line of the same kind', () => {
    const groups = groupSyncReport([item({}), item({ status: 'failed', reason: 'Rejected' }), item({ status: 'failed', reason: 'Rejected' })]);
    const lines = groups[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ status: 'failed', count: 2, reasons: ['Rejected'] });
  });
});
