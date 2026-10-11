// The two decisions that fix BUG-03 and SEC-27, kept as PURE functions so they
// can be tested without IndexedDB, a browser, or a service worker.
//
// Sprint 159a. Both bugs had one cause — a queue row carried neither an owner
// nor a cross-context claim — so both answers live on the row, and these are
// the rules that read it.

/** How long a claim stays valid before another context may take the row.
 *
 *  ⚠ This is a LEASE, not a lock, and the length is a real trade-off. Too
 *  short and a slow sync gets its row stolen mid-flight, which is the very
 *  double-send this exists to prevent. Too long and a row claimed by a service
 *  worker the browser then killed sits unsendable until it expires. 60s is
 *  well past any normal write (the API's own slowest path is a 30s prediction
 *  timeout, and the queue never sends those) and short enough that a killed
 *  context self-heals within a minute. */
export const CLAIM_LEASE_MS = 60_000;

/** The subset of a queued write these rules need. Declared structurally rather
 *  than importing QueuedWrite so this module stays free of the IndexedDB types
 *  and can be exercised with plain objects. */
export interface ClaimableRow {
  /** Who enqueued it. `undefined` on rows written before Sprint 159a. */
  userId?: string;
  claimedAt?: number | null;
  claimedBy?: string | null;
}

/**
 * May `contextId` send this row right now?
 *
 * A claim is a promise that some context is mid-send. Re-claiming your own row
 * is allowed — a context that crashed and restarted should not be locked out of
 * its own work.
 */
export function isClaimable(row: ClaimableRow, contextId: string, now: number): boolean {
  if (!row.claimedAt) return true;
  if (row.claimedBy === contextId) return true;
  return now - row.claimedAt >= CLAIM_LEASE_MS;
}

/**
 * Whose session may send this row?
 *
 * SEC-27: the queue drains on every app load, before any login check, using
 * whatever cookie the browser holds. On a shared clinic PC that let one user's
 * offline work sync under the next user's session, with the audit trail
 * recording the wrong author.
 *
 * ⚠ A row that is not yours is HELD, never dropped. It is somebody's unsynced
 * clinical work, and CLAUDE.md's never-hard-delete instinct applies to the
 * spirit of it: the owner signs in, and it syncs as theirs.
 */
export function isOwnedBy(row: ClaimableRow, currentUserId: string | null): boolean {
  // Nobody signed in: send nothing. Previously this reached the API and was
  // turned back by a 401, which was safe but noisy — it burned a refresh
  // attempt and flagged the row as auth-blocked for a user who had simply not
  // arrived yet.
  if (!currentUserId) return false;

  // Rows enqueued before Sprint 159a carry no owner. They drain under whoever
  // is signed in, exactly as they did before this change — refusing them would
  // strand real unsynced work behind an app update, which is a worse failure
  // than the one being fixed. Self-limiting: the queue is short-lived, so this
  // window closes the first time it drains.
  if (row.userId === undefined) return true;

  return row.userId === currentUserId;
}
