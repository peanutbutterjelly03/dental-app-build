import { describe, expect, it } from 'vitest';
import { buildReport, type WriteEntry } from './syncReportModel';
import { buildDays, buildDateGroups, dayLabel, localDayKey } from './syncReportVisual';

let id = 0;
const NOW = new Date(2026, 9, 10, 22, 0).getTime();
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
const write = (over: Partial<WriteEntry>): WriteEntry => ({
  kind: 'write', id: ++id, runId: 'r1', at: at(10, 22), queuedAt: at(10, 21, id % 50), status: 'synced', op: 'update', resource: 'tooth-records', recordId: `t${id}`,
  studentId: 's1', studentName: 'ABO, RYZELLE', module: 'Dental chart', label: 'Tooth record added', subject: 'Tooth record', fields: [], ...over,
});
const tooth = (n: number, when = at(10, 21, n % 50)) => write({
  op: 'create', queuedAt: when, fields: [{ field: 'tooth_number', before: undefined, after: n }, { field: 'condition', before: undefined, after: 'D' }, { field: 'visit_number', before: undefined, after: 1 }],
});
const days = (entries: WriteEntry[]) => buildDays(buildReport(entries)[0].rows, NOW);

describe('buildDays', () => {
  it('puts all of one day in one block, newest day first', () => {
    const d = days([tooth(22), tooth(23), tooth(24, at(9, 14, 5))]);
    expect(d.map((x) => x.key)).toEqual(['2026-10-10', '2026-10-09']);
    expect(d[0].teeth.map((t) => t.tooth)).toEqual([22, 23]);
    expect(d[0].label).toBe('Today');
    expect(d[1].label).toBe('Yesterday');
  });

  it('reads the tooth and its condition from a created record', () => {
    const [d] = days([tooth(36)]);
    expect(d.teeth).toEqual([{ tooth: 36, before: '', cond: 'D', removed: false, edits: 1 }]);
  });

  it('a created medical history shows only the boxes that were ticked', () => {
    const [d] = days([write({
      op: 'create', resource: 'medical-histories', label: 'Medical history added', subject: 'Medical history',
      fields: [{ field: 'iptr_id', before: undefined, after: 'i1' }, { field: 'hypertension', before: undefined, after: true }, { field: 'anemia', before: undefined, after: true }, { field: 'asthma', before: undefined, after: false }, { field: 'allergies', before: undefined, after: 'Penicillin' }],
    })]);
    expect(d.flags.map((f) => [f.label, f.from, f.to, f.source])).toEqual([['Hypertension', false, true, 'med'], ['Anemia', false, true, 'med']]);
    expect(d.texts).toEqual([{ label: 'Allergies', from: '', to: 'Penicillin' }]);
  });

  it('an updated yes/no field becomes a switch, a number becomes a measurement', () => {
    const [d] = days([
      write({ resource: 'oral-health-conditions', label: 'Oral health conditions updated', subject: 'Oral health conditions', recordId: 'o1', fields: [{ field: 'calculus', before: false, after: true }] }),
      write({ resource: 'student-iptrs', label: 'School year record updated', subject: 'School year record', recordId: 'i1', fields: [{ field: 'weight_kg', before: 18.5, after: 19 }] }),
    ]);
    expect(d.flags).toEqual([{ label: 'Calculus', from: false, to: true, source: 'oral', edits: 1 }]);
    expect(d.measures).toEqual([{ label: 'Weight', unit: 'kg', from: 18.5, to: 19, edits: 1 }]);
  });

  it('a field flipped on and back off shows nothing', () => {
    const a = write({ resource: 'oral-health-conditions', recordId: 'o1', subject: 'Oral health conditions', fields: [{ field: 'calculus', before: false, after: true }] });
    const b = write({ resource: 'oral-health-conditions', recordId: 'o1', subject: 'Oral health conditions', fields: [{ field: 'calculus', before: true, after: false }] });
    expect(days([a, b])[0].flags).toEqual([]);
  });

  it('an edit that did not sync is kept in full, not drawn', () => {
    const [d] = days([write({ status: 'conflict', reason: 'Someone else changed this.', resource: 'oral-health-conditions', recordId: 'o1', fields: [{ field: 'calculus', before: false, after: true }] })]);
    expect(d.problems).toHaveLength(1);
    expect(d.flags).toEqual([]);
  });

  it('unknown kinds fall back to one short line', () => {
    const [d] = days([write({ resource: 'treatments', op: 'create', label: 'Treatment added', subject: 'Treatment', fields: [{ field: 'diagnosis', before: undefined, after: 'Caries' }] })]);
    expect(d.texts).toEqual([{ label: 'Treatment added', from: '', to: 'Diagnosis Caries' }]);
  });
});

describe('buildDateGroups', () => {
  it('groups by date first, newest first, attention students first inside a date', () => {
    const a = write({ studentId: 's1', studentName: 'ZAMORA, Rico', op: 'create', fields: [{ field: 'tooth_number', before: undefined, after: 11 }, { field: 'condition', before: undefined, after: 'D' }] });
    const b = write({ studentId: 's2', studentName: 'ACIO, Khalil', queuedAt: at(10, 20), op: 'create', fields: [{ field: 'tooth_number', before: undefined, after: 12 }, { field: 'condition', before: undefined, after: 'D' }] });
    const held = write({ studentId: 's3', studentName: 'LOPEZ, Carla', queuedAt: at(10, 19), status: 'conflict', reason: 'x', resource: 'oral-health-conditions', recordId: 'o', fields: [{ field: 'calculus', before: false, after: true }] });
    const old = write({ studentId: 's2', studentName: 'ACIO, Khalil', queuedAt: at(8, 9), op: 'create', fields: [{ field: 'tooth_number', before: undefined, after: 13 }, { field: 'condition', before: undefined, after: 'F' }] });
    const groups = buildDateGroups(buildReport([a, b, held, old]), NOW);
    expect(groups.map((g) => g.key)).toEqual(['2026-10-10', '2026-10-08']);
    expect(groups[0].items.map((i) => i.student.name)).toEqual(['LOPEZ, Carla', 'ACIO, Khalil', 'ZAMORA, Rico']);
    expect(groups[1].items.map((i) => i.student.name)).toEqual(['ACIO, Khalil']);
  });
});

describe('cleared teeth', () => {
  it('an archived tooth keeps its number and the condition it had', () => {
    const [d] = days([write({ op: 'archive', label: 'Tooth record archived', subject: 'Tooth record #22', fields: [{ field: 'tooth_number', before: 22, after: undefined }, { field: 'condition', before: 'D', after: undefined }] })]);
    expect(d.teeth).toEqual([{ tooth: 22, before: 'D', cond: '', removed: true, edits: 1 }]);
  });
});

describe('noise', () => {
  it('a newly created dental chart adds no line of its own', () => {
    const [d] = days([write({ resource: 'dental-charts', op: 'create', label: 'Dental chart added', subject: 'Dental chart', fields: [{ field: 'date_charted', before: undefined, after: '2026-10-10' }] }), tooth(11)]);
    expect(d.texts).toEqual([]);
    expect(d.teeth).toHaveLength(1);
  });
});

describe('day helpers', () => {
  it('labels today, yesterday and older days', () => {
    expect(dayLabel(localDayKey(NOW), NOW)).toBe('Today');
    expect(dayLabel(localDayKey(NOW - 86_400_000), NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-03', NOW)).toMatch(/Oct/);
  });
});
