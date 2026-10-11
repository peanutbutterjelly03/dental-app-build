// Tests for the BUG-03 / SEC-27 rules — Sprint 159a.
//
// Unlike the Sprint 158 files these are NOT characterization tests: this
// behaviour is new, so these assert what it is supposed to do. The cases that
// matter are the two that were wrong before: a second context must not send a
// row that is already claimed, and a user must not send another user's work.

import { describe, it, expect } from 'vitest';
import { isClaimable, isOwnedBy, CLAIM_LEASE_MS } from './queueRules';

const NOW = 1_700_000_000_000;
const ME = 'ctx-page';
const OTHER = 'ctx-sw';

describe('isClaimable — the BUG-03 rule', () => {
  it('allows an unclaimed row', () => {
    expect(isClaimable({}, ME, NOW)).toBe(true);
    expect(isClaimable({ claimedAt: null, claimedBy: null }, ME, NOW)).toBe(true);
  });

  it('REFUSES a row another context claimed moments ago — this is the fix', () => {
    expect(isClaimable({ claimedAt: NOW - 1_000, claimedBy: OTHER }, ME, NOW)).toBe(false);
  });

  it('allows a context to re-claim its OWN row, so a restart is not locked out', () => {
    expect(isClaimable({ claimedAt: NOW - 1_000, claimedBy: ME }, ME, NOW)).toBe(true);
  });

  it('releases a claim once the lease expires, so a killed context self-heals', () => {
    const stale = { claimedAt: NOW - CLAIM_LEASE_MS, claimedBy: OTHER };
    expect(isClaimable(stale, ME, NOW)).toBe(true);
    const nearlyStale = { claimedAt: NOW - (CLAIM_LEASE_MS - 1), claimedBy: OTHER };
    expect(isClaimable(nearlyStale, ME, NOW)).toBe(false);
  });
});

describe('isOwnedBy — the SEC-27 rule', () => {
  it('sends nothing when nobody is signed in', () => {
    expect(isOwnedBy({ userId: 'user-a' }, null)).toBe(false);
    expect(isOwnedBy({}, null)).toBe(false);
  });

  it("REFUSES another user's row — this is the fix", () => {
    // The shared clinic PC: aide A queues offline and logs out, dentist B
    // signs in. Before this rule, A's writes synced under B's session and the
    // audit trail recorded B as the author.
    expect(isOwnedBy({ userId: 'aide-a' }, 'dentist-b')).toBe(false);
  });

  it('sends your own row', () => {
    expect(isOwnedBy({ userId: 'aide-a' }, 'aide-a')).toBe(true);
  });

  it('drains a legacy row with no owner under whoever is signed in', () => {
    // Deliberate: rows enqueued before this change carry no userId, and
    // refusing them would strand real unsynced work behind an app update.
    expect(isOwnedBy({}, 'dentist-b')).toBe(true);
    expect(isOwnedBy({ userId: undefined }, 'dentist-b')).toBe(true);
  });

  it('does not treat an empty-string owner as legacy', () => {
    // '' is a value, not an absence. Guarding this because `?? ` and `||`
    // confusion around empty strings is exactly how a "legacy" branch starts
    // swallowing real rows.
    expect(isOwnedBy({ userId: '' }, 'dentist-b')).toBe(false);
  });
});
