import { describe, it, expect } from 'vitest';
import { bodyWithSync, conflictTarget, mintOperationId } from './syncEnvelope';

describe('bodyWithSync', () => {
  it('sends the id of the change and the values it started from, for the fields it changes only', () => {
    const out = bodyWithSync({
      method: 'PUT',
      operationId: 'op-1234-aaaa',
      body: { section: 'B' },
      baselineSnapshot: { section: 'A', grade_level: 'Grade 3', address: 'X' },
    }) as Record<string, unknown>;
    expect(out).toEqual({ section: 'B', _sync: { operationId: 'op-1234-aaaa', base: { section: 'A' } } });
  });
  it('sends no starting values for a create, but still the id (that is what makes a retry safe)', () => {
    const out = bodyWithSync({ method: 'POST', operationId: 'op-1234-aaaa', body: { last_name: 'Cruz' }, baselineSnapshot: { last_name: 'x' } }) as Record<string, any>;
    expect(out._sync).toEqual({ operationId: 'op-1234-aaaa', base: {} });
  });
  it('sends an edit without a saved baseline with an empty base (the server then cannot call it a clash)', () => {
    expect((bodyWithSync({ method: 'PUT', operationId: 'op-1234-aaaa', body: { a: 1 } }) as any)._sync.base).toEqual({});
  });
  it('does not mutate the queued body', () => {
    const body = { section: 'B' };
    bodyWithSync({ method: 'PUT', operationId: 'op-1234-aaaa', body });
    expect(body).toEqual({ section: 'B' });
  });
  it('leaves a body-less call (an archive) and non-object bodies alone', () => {
    expect(bodyWithSync({ method: 'PATCH', body: undefined })).toBeUndefined();
    expect(bodyWithSync({ method: 'PUT', body: [1, 2] })).toEqual([1, 2]);
  });
  it('mints an id the server accepts when the row has none (rows queued before this existed)', () => {
    const id = (bodyWithSync({ method: 'PUT', body: { a: 1 } }) as any)._sync.operationId as string;
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(mintOperationId()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
});

describe('conflictTarget', () => {
  it('maps a single record to the server model and id', () => {
    expect(conflictTarget('/students/64b5f0c2a1b2c3d4e5f60718')).toEqual({ model: 'Student', recordId: '64b5f0c2a1b2c3d4e5f60718' });
    expect(conflictTarget('/tooth-records/64b5f0c2a1b2c3d4e5f60718')?.model).toBe('ToothRecord');
  });
  it('is null for lists, archives, pending records and other resources', () => {
    for (const e of ['/students', '/students/64b5f0c2a1b2c3d4e5f60718/archive', '/students/pending-3', '/users/64b5f0c2a1b2c3d4e5f60718'])
      expect(conflictTarget(e), e).toBeNull();
  });
});
