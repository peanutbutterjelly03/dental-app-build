import { describe, expect, it } from 'vitest';
import { chainBaseline } from './baseline';
import { conflictingFields } from '../../../server/utils/syncConflict';

describe('chainBaseline', () => {
  const server = { _id: 'a', dmf: 0, allergies: '' };

  it('is the server copy when nothing earlier is queued', () => {
    expect(chainBaseline(server, [])).toEqual(server);
  });

  it('is undefined without a server copy (no conflict protection, as before)', () => {
    expect(chainBaseline(undefined, [{ dmf: 1 }])).toBeUndefined();
  });

  it('overlays earlier edits oldest first, later ones winning', () => {
    expect(chainBaseline(server, [{ dmf: 1 }, { dmf: 2, allergies: 'Penicillin' }])).toMatchObject({ dmf: 2, allergies: 'Penicillin' });
  });

  it('ignores the sync envelope and non-object bodies', () => {
    expect(chainBaseline(server, [{ dmf: 1, _sync: { operationId: 'x' } }, null, 'x', [1]])).toEqual({ ...server, dmf: 1 });
  });

  it('does not clash with its own earlier edit once the first one has been applied', () => {
    // Edit 1: dmf 0 -> 1. Edit 2 (queued after it): dmf 1 -> 2.
    const afterFirstApplied = { ...server, dmf: 1 };
    const secondBase = chainBaseline(server, [{ dmf: 1 }])!;
    expect(conflictingFields({ dmf: secondBase.dmf }, { dmf: 2 }, afterFirstApplied)).toEqual([]);
    // The old behaviour (base = the cached server copy) clashes with itself.
    expect(conflictingFields({ dmf: server.dmf }, { dmf: 2 }, afterFirstApplied)).toEqual(['dmf']);
  });

  it('still clashes when someone else changed the field in between', () => {
    const someoneElse = { ...server, dmf: 5 };
    const secondBase = chainBaseline(server, [{ dmf: 1 }])!;
    expect(conflictingFields({ dmf: secondBase.dmf }, { dmf: 2 }, someoneElse)).toEqual(['dmf']);
  });
});
