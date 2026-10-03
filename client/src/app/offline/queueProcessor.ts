import { getQueue, removeFromQueue, markFailed, markAuthRequired, markConflict, resetToPending, resolveConflictKeepMine, type QueuedWrite } from './db';
import { notifyQueueChange } from './queueEvents';

let processing = false;

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
    const queue = await getQueue();
    for (const write of queue) {
      if (write.status === 'failed' || write.status === 'auth') break;
      if (write.status === 'conflict') continue; // already flagged, waiting on manual resolution — doesn't block others

      const conflictRecord = await checkForConflict(write);
      if (conflictRecord) {
        await markConflict(write.id!, conflictRecord);
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
          notifyQueueChange();
          break;
        } else {
          // Server actively rejected it (e.g. validation error) — not a
          // network problem, so retrying immediately won't help. Mark it
          // failed and stop; later items may depend on this one's data.
          // Prefer the server's own wording: a 409 here is usually the
          // duplicate-student guard, and "error 409" gives whoever is clearing
          // the queue nothing to act on.
          await markFailed(
            write.id!,
            result.message ?? `The server rejected this change (error ${result.status}).`,
          );
          notifyQueueChange();
          break;
        }
      } catch {
        // Network failed mid-sync (went offline again) — stop, leave this
        // item pending, it'll retry on the next online event.
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
