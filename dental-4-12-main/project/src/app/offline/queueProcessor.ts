import { getQueue, removeFromQueue, markFailed, markAuthRequired, markConflict, resetToPending, resolveConflictKeepMine, claimWrite, releaseClaim, type QueuedWrite } from './db';
import { notifyQueueChange } from './queueEvents';
import { isOwnedBy } from './queueRules';
import { loadUserCache } from './authCache';

// ⚠ NOT a cross-context guard, and it was mistaken for one until Sprint 159a.
// This module is instantiated separately in the page and in the service worker,
// so each has its OWN copy of this flag. It still earns its place — it stops a
// single context re-entering itself when `online` fires while a drain is already
// running — but the guard that actually prevents two contexts sending the same
// write is the per-row claim in db.ts (BUG-03).
let processing = false;

/** Identifies THIS context for the duration of its life. A page load and a
 *  service-worker activation each get their own, which is what makes a claim
 *  meaningful — "someone else is already sending this" is only answerable if
 *  the two can tell each other apart. */
const CONTEXT_ID = `${typeof window === 'undefined' ? 'sw' : 'page'}-${Math.random().toString(36).slice(2)}`;

// A raw request, deliberately NOT going through apiClient — apiClient queues
// failed writes, and reusing it here would risk re-queueing a sync attempt
// that just failed, defeating "stop queue if sync fails, never skip."
/** Reads the server's own `error` string off a rejection so the queue can show
 *  what actually went wrong instead of a bare status code. Returns undefined
 *  for responses with no JSON body. */
async function rejectionMessage(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  const error = body && typeof body.error === 'string' ? body.error : undefined;
  return error;
}

async function sendDirect(write: QueuedWrite): Promise<{ ok: boolean; status: number; message?: string }> {
  const res = await fetch(`/api${write.endpoint}`, {
    method: write.method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(write.body),
  });

  if (res.status === 401) {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then((r) => r.ok).catch(() => false);
    if (refreshed) {
      const retry = await fetch(`/api${write.endpoint}`, {
        method: write.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(write.body),
      });
      return { ok: retry.ok, status: retry.status, message: retry.ok ? undefined : await rejectionMessage(retry) };
    }
  }

  return { ok: res.ok, status: res.status, message: res.ok ? undefined : await rejectionMessage(res) };
}

// Detects whether the server's current value for any field this write is
// trying to change has drifted from what this device last saw (baseline) —
// meaning someone else edited the same field while this device was offline.
// Only checks fields this write actually touches; unrelated fields changing
// elsewhere isn't a conflict for this write.
function detectConflict(baseline: Record<string, unknown>, current: Record<string, unknown>, changedFields: string[]): boolean {
  return changedFields.some((field) => JSON.stringify(baseline[field]) !== JSON.stringify(current[field]));
}

async function checkForConflict(write: QueuedWrite): Promise<Record<string, unknown> | null> {
  if (write.method === 'POST' || !write.baselineSnapshot) return null;
  try {
    const res = await fetch(`/api${write.endpoint}`, { credentials: 'include' });
    if (!res.ok) return null; // can't verify — don't block the write over an unrelated read failure
    const current = await res.json();
    const changedFields = typeof write.body === 'object' && write.body ? Object.keys(write.body as object) : [];
    if (detectConflict(write.baselineSnapshot, current, changedFields)) return current;
    return null;
  } catch {
    return null; // network hiccup checking — not itself a conflict, fall through to the normal send attempt
  }
}

// FIFO, strictly sequential. A network failure or real server rejection
// stops the whole queue (per CLAUDE.md's "stop queue if sync fails, never
// skip") — but a data conflict on one record is isolated to that record and
// does NOT block unrelated queued writes behind it (user's explicit choice).
export async function processQueue(): Promise<void> {
  if (processing || !navigator.onLine) return;
  processing = true;
  try {
    // SEC-27. Read once per drain rather than per row: the signed-in user
    // cannot change mid-drain without a page load, and a load starts a fresh
    // drain anyway.
    const currentUserId = loadUserCache()?.id ?? null;
    const queue = await getQueue();
    for (const write of queue) {
      if (write.status === 'failed' || write.status === 'auth') break;
      if (write.status === 'conflict') continue; // already flagged, waiting on manual resolution — doesn't block others

      // SEC-27: someone else's unsynced work, or nobody signed in. HOLD it —
      // skip, never drop. `continue` rather than `break` for the same reason a
      // conflict does: a row waiting for its owner to sign in must not wedge
      // the writes of the person actually sitting here.
      if (!isOwnedBy(write, currentUserId)) continue;

      // BUG-03: claim the row before sending it. If another context (the
      // service worker, or another tab) already holds it, leave it alone — it
      // is mid-flight there, and sending it here is the duplicate.
      if (!(await claimWrite(write.id!, CONTEXT_ID))) continue;

      const conflictRecord = await checkForConflict(write);
      if (conflictRecord) {
        await markConflict(write.id!, conflictRecord);
        await releaseClaim(write.id!);
        notifyQueueChange();
        continue;
      }

      try {
        const result = await sendDirect(write);
        if (result.ok) {
          await removeFromQueue(write.id!);
          notifyQueueChange();
        } else if (result.status === 401 || result.status === 403) {
          // The session expired while this device was offline and the refresh
          // token couldn't renew it. The write itself is perfectly valid, so
          // this is NOT a permanent failure — flag it as needing sign-in and
          // stop. Signing back in and hitting Retry will push it through.
          await markAuthRequired(write.id!, 'Your session expired — sign in again to sync this change.');
          await releaseClaim(write.id!);
          notifyQueueChange();
          break;
        } else {
          // Server actively rejected it (e.g. validation error) — not a
          // network problem, so retrying immediately won't help. Mark it
          // failed and stop; later items may depend on this one's data.
          // Prefer the server's own wording: a 409 here is usually the
          // duplicate-student guard, and "error 409" gives whoever is clearing
          // the queue nothing to act on.
          //
          // A 404 is the one case where the server's own wording is useless.
          // Since Sprint 159b an archived record answers 404 to a PUT (BUG-04),
          // and "Not found" tells the person clearing the queue nothing about
          // what to do. Name the likely cause instead: this write cannot ever
          // succeed as it stands, so Discard is the action, not Retry.
          await markFailed(
            write.id!,
            result.status === 404
              ? 'The record this change belongs to was archived or removed while you were offline, so it can no longer be saved. Discard this change, then re-enter it on the current record if it is still needed.'
              : result.message ?? `The server rejected this change (error ${result.status}).`,
          );
          await releaseClaim(write.id!);
          notifyQueueChange();
          break;
        }
      } catch {
        // Network failed mid-sync (went offline again) — stop, leave this
        // item pending, it'll retry on the next online event.
        //
        // ⚠ Release the claim, or the retry waits out a whole lease for no
        // reason. The lease exists for the case this line cannot cover: a
        // context KILLED mid-send, which never reaches any catch block.
        await releaseClaim(write.id!).catch(() => {});
        break;
      }
    }
  } finally {
    processing = false;
  }
}

// Page-context only (uses window) — Sprint 19's tab-open sync trigger.
export function initQueueProcessor(): void {
  window.addEventListener('online', () => { processQueue(); });
  if (navigator.onLine) processQueue();
}

// Manual retry (offline banner's "Retry" button): reset the oldest blocked
// item back to pending and resume normal FIFO processing from there. Note
// that a retry only changes anything if the underlying cause is gone — a
// deterministic server rejection will simply fail again, which is why the
// banner also offers Discard.
export async function retryQueue(): Promise<void> {
  const queue = await getQueue();
  const firstBlocked = queue.find((w) => w.status === 'failed' || w.status === 'auth');
  if (firstBlocked?.id !== undefined) {
    await resetToPending(firstBlocked.id);
    notifyQueueChange();
  }
  await processQueue();
}

// Drop a write that the server will never accept. Without this a single bad
// item wedges the whole FIFO queue permanently, since processQueue() stops at
// the first failed entry.
export async function discardFailedWrite(id: number): Promise<void> {
  await removeFromQueue(id);
  notifyQueueChange();
  await processQueue();
}

// Conflict resolution (offline banner's conflict review UI).
export async function keepMyChange(id: number): Promise<void> {
  await resolveConflictKeepMine(id);
  notifyQueueChange();
  await processQueue();
}

export async function discardMyChange(id: number): Promise<void> {
  await removeFromQueue(id);
  notifyQueueChange();
}
