import { describe, it, expect } from 'vitest';
import { isRevoked } from './sessionValidity';

const at = (iso: string) => new Date(iso);
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('isRevoked (SEC-12)', () => {
  it('nothing is revoked until a cutoff exists', () => {
    expect(isRevoked(secs('2026-09-01T00:00:00Z'), null)).toBe(false);
    expect(isRevoked(secs('2026-09-01T00:00:00Z'), undefined)).toBe(false);
    expect(isRevoked(undefined, null)).toBe(false);
  });

  it('a token issued before the cutoff is revoked', () => {
    expect(isRevoked(secs('2026-09-01T10:00:00Z'), at('2026-09-01T10:00:05Z'))).toBe(true);
  });

  it('a token issued after the cutoff survives', () => {
    expect(isRevoked(secs('2026-09-01T10:00:10Z'), at('2026-09-01T10:00:05Z'))).toBe(false);
  });

  it('a token minted in the SAME second as the cutoff survives: the fresh session after a password change', () => {
    // The cutoff has milliseconds; iat does not. Without flooring, this token
    // would compare as older than the change that just created it.
    expect(isRevoked(secs('2026-09-01T10:00:05Z'), at('2026-09-01T10:00:05.750Z'))).toBe(false);
  });

  it('fails closed: no iat once a cutoff exists', () => {
    expect(isRevoked(undefined, at('2026-09-01T10:00:05Z'))).toBe(true);
  });
});
