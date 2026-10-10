import { describe, expect, it } from 'vitest';
import { fieldChanges, opOf, resolveStudent } from './syncHistory';

describe('fieldChanges', () => {
  it('lists changed fields with the original value, hiding ids and the envelope', () => {
    const out = fieldChanges({
      method: 'PUT', endpoint: '/dental-charts/aaaaaaaaaaaaaaaaaaaaaaaa',
      body: { dmf_index: 2, iptr_id: 'x', _sync: { operationId: 'o' }, notes: 'same' },
      originalSnapshot: { dmf_index: 0, notes: 'same', iptr_id: 'x' },
      baselineSnapshot: { dmf_index: 1, notes: 'same' },
    });
    expect(out).toEqual([{ field: 'dmf_index', before: 0, after: 2 }]);
  });

  it('uses the original, not the chained baseline, as the before value', () => {
    const [c] = fieldChanges({ method: 'PUT', endpoint: '/students/aaaaaaaaaaaaaaaaaaaaaaaa', body: { contact_number: '2' }, originalSnapshot: { contact_number: '0' }, baselineSnapshot: { contact_number: '1' } });
    expect(c.before).toBe('0');
  });

  it('a create has no before value', () => {
    const [c] = fieldChanges({ method: 'POST', endpoint: '/treatments', body: { treatment_done: 'Filling' } });
    expect(c).toEqual({ field: 'treatment_done', before: undefined, after: 'Filling' });
  });

  it('keeps the value when there is no cached copy (before unknown)', () => {
    const [c] = fieldChanges({ method: 'PUT', endpoint: '/students/aaaaaaaaaaaaaaaaaaaaaaaa', body: { section: 'B' } });
    expect(c).toEqual({ field: 'section', before: undefined, after: 'B' });
  });
});

describe('opOf', () => {
  it('tells create, update and archive apart', () => {
    expect(opOf({ method: 'POST', endpoint: '/treatments' })).toBe('create');
    expect(opOf({ method: 'PUT', endpoint: '/students/aaaaaaaaaaaaaaaaaaaaaaaa' })).toBe('update');
    expect(opOf({ method: 'PATCH', endpoint: '/students/aaaaaaaaaaaaaaaaaaaaaaaa/archive' })).toBe('archive');
  });
});

describe('resolveStudent', () => {
  const TOOTH = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const created = new Map<string, Record<string, unknown>>([
    [`tooth-records|${TOOTH}`, { chart_id: 'c1', tooth_number: 22 }],
    ['dental-charts|c1', { iptr_id: 'i1' }],
    ['student-iptrs|i1', { student_id: 's1' }],
    ['students|s1', { last_name: 'Acacio', first_name: 'Khalil', grade_level: 'Kinder', section: 'Apple Green' }],
  ]);

  it('finds the student of an archive that has no body and no snapshot, through the record itself', () => {
    const write = { method: 'PATCH', endpoint: `/tooth-records/${TOOTH}/archive`, body: undefined } as never;
    return expect(resolveStudent(write, undefined, created)).resolves.toEqual({ studentId: 's1', studentName: 'Acacio, Khalil', studentSub: 'Kinder, Apple Green' });
  });

  it('gives up cleanly when nothing is known', async () => {
    const write = { method: 'PATCH', endpoint: `/tooth-records/${TOOTH}/archive`, body: undefined } as never;
    expect(await resolveStudent(write, undefined, new Map())).toEqual({});
  });
});
