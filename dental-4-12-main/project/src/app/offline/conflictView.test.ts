import { describe, it, expect } from 'vitest';
import { conflictFields, serverChangedAt, recordLabel } from './conflictView';

describe('conflictFields', () => {
  const write = {
    body: { section: 'B', grade_level: 'Grade 3', address: 'Same St' },
    baselineSnapshot: { section: 'A', grade_level: 'Grade 3', address: 'Same St' },
    conflictServerRecord: { section: 'C', grade_level: 'Grade 4', address: 'Same St' },
  };
  it('lists only the fields where the two versions disagree', () => {
    expect(conflictFields(write).map((f) => f.field).sort()).toEqual(['Grade Level', 'Section']);
  });
  it('flags a field the server changed after this device started editing, and puts it first', () => {
    const fields = conflictFields(write);
    expect(fields[0]).toMatchObject({ field: 'Section', mine: 'B', server: 'C', started: 'A', serverChanged: true });
  });
  it('does not call it a server change when only this device changed the field', () => {
    const f = conflictFields({ body: { section: 'B' }, baselineSnapshot: { section: 'A' }, conflictServerRecord: { section: 'A' } });
    expect(f[0]).toMatchObject({ serverChanged: false, mine: 'B', server: 'A' });
  });
  it('leaves out internal fields and a field both sides already agree on', () => {
    expect(conflictFields({ body: { _id: 'x', section: 'B' }, conflictServerRecord: { section: 'B' } })).toEqual([]);
  });
  it('says (empty) rather than showing nothing, and has no "started" value without a baseline', () => {
    const f = conflictFields({ body: { section: '' }, conflictServerRecord: { section: 'C' } });
    expect(f[0]).toMatchObject({ mine: '(empty)', started: null });
  });
});

describe('recordLabel', () => {
  it('names a student from the server copy', () => {
    expect(recordLabel({ body: {}, conflictServerRecord: { last_name: 'Cruz', first_name: 'Juan' } })).toBe('Cruz, Juan');
  });
  it('is null when the record carries no name', () => {
    expect(recordLabel({ body: {}, conflictServerRecord: { section: 'A' } })).toBeNull();
    expect(recordLabel({ body: {} })).toBeNull();
  });
});

describe('serverChangedAt', () => {
  it('reads the record timestamp when present', () => {
    expect(serverChangedAt({ body: {}, conflictServerRecord: { updated_at: '2026-10-03T08:00:00Z' } })).toBe('2026-10-03T08:00:00Z');
    expect(serverChangedAt({ body: {}, conflictServerRecord: {} })).toBeNull();
  });
});
