import { describe, expect, it } from 'vitest';
import { fieldChanges, opOf } from './syncHistory';

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
