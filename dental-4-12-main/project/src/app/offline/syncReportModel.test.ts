import { describe, expect, it } from 'vitest';
import { buildReport, type HistoryEntry, type WriteEntry } from './syncReportModel';

let id = 0;
const write = (over: Partial<WriteEntry>): WriteEntry => ({
  kind: 'write', id: ++id, runId: 'r1', at: 4000, queuedAt: 1000 + id, status: 'synced', op: 'update', resource: 'dental-charts', recordId: 'c1',
  studentId: 's1', studentName: 'ACIO, Khalil', module: 'Dental chart', label: 'Dental chart updated', subject: 'Dental chart',
  fields: [{ field: 'dmf_index', before: 0, after: 1 }], ...over,
});

describe('buildReport', () => {
  it('one row per field, with the original and the synced value', () => {
    const [s] = buildReport([write({})]);
    expect(s.status).toBe('synced');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].before).toBe('0');
    expect(s.rows[0].current.value).toBe('1');
    expect(s.rows[0].versions.map((v) => v.label)).toEqual(['Original', 'Latest']);
  });

  it('two edits of the same field become one row with three versions, latest in force', () => {
    const a = write({ fields: [{ field: 'dmf_index', before: 0, after: 1 }] });
    const b = write({ fields: [{ field: 'dmf_index', before: 1, after: 2 }] });
    const [s] = buildReport([b, a]); // order of input does not matter
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].versions.map((v) => [v.label, v.value])).toEqual([['Original', '0'], ['Edit 1', '1'], ['Latest', '2']]);
    expect(s.rows[0].current.value).toBe('2');
    expect(s.rows[0].picked).toBe(false);
  });

  it('a picked version is the one in force, and Original counts as restored', () => {
    const a = write({});
    const b = write({ fields: [{ field: 'dmf_index', before: 1, after: 2 }] });
    const restore: HistoryEntry = { kind: 'restore', id: ++id, runId: 'r1', at: 5000, resource: 'dental-charts', recordId: 'c1', field: 'dmf_index', picked: 'orig', value: 0 };
    const [s] = buildReport([a, b, restore]);
    expect(s.rows[0].current.value).toBe('0');
    expect(s.rows[0].picked).toBe(true);
    expect(s.status).toBe('restored');
  });

  it('a clash puts the student under needs attention, first in the list', () => {
    const ok = write({ studentId: 's2', studentName: 'ZAMORA, Rico' });
    const held = write({ status: 'conflict', reason: 'Someone else changed this record while you were offline.' });
    const list = buildReport([ok, held]);
    expect(list.map((s) => s.name)).toEqual(['ACIO, Khalil', 'ZAMORA, Rico']);
    expect(list[0].status).toBe('attention');
    expect(list[0].rows[0].canPick).toBe(false);
  });

  it('a created record is ONE summarised row that cannot be restored', () => {
    const fields = ['a', 'b', 'c', 'd', 'e', 'f'].map((f) => ({ field: f, before: undefined, after: f.toUpperCase() }));
    const [s] = buildReport([write({ op: 'create', resource: 'tooth-records', label: 'Tooth record added', fields })]);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].before).toBe('(none)');
    expect(s.rows[0].current.value).toBe('A A, B B, C C, D D +2 more');
    expect(s.rows[0].canPick).toBe(false);
  });

  it('lists students with nothing to sync as No changes', () => {
    const list = buildReport([write({})], [{ studentId: 's9', name: 'Uy, Gabriel' }, { studentId: 's1', name: 'ACIO, Khalil' }]);
    expect(list.find((s) => s.studentId === 's9')?.status).toBe('none');
    expect(list.filter((s) => s.studentId === 's1')).toHaveLength(1);
  });
});

describe('changes whose student is not known', () => {
  it('stay together as ONE entry, not one student per record', () => {
    const archived = (recordId: string) => write({ studentId: undefined, studentName: undefined, op: 'archive', resource: 'tooth-records', recordId, label: 'Tooth record archived', subject: 'Tooth record', fields: [] });
    const list = buildReport([archived('a1'), archived('a2'), archived('a3')]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Unknown student');
    expect(list[0].rows).toHaveLength(3);
  });
});

