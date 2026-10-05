import { getQueue, getWrite, completeWrite, removeFromQueue, markFailed, markAuthRequired, markConflict, resetToPending, resolveConflictKeepMine, claimWrite, releaseClaim, type QueuedWrite } from './db';
import { notifyQueueChange } from './queueEvents';
import { notifySyncReport, type SyncReportItem } from './syncReport';
import { describeWrite } from './describeWrite';
import { hasUnresolvedPending, pendingRowIdsIn } from './idRemap';
import { bodyWithSync } from './syncEnvelope';
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
/** What the server said about a refusal: its own `error` string (so the queue can
 *  show what actually went wrong, not a bare status code) and the whole body (a
 *  conflict answer carries data the queue acts on). Both undefined for a response
 *  with no JSON body. */
async function readFailure(res: Response): Promise<{ message?: string; body?: Record<string, unknown> }> {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') return {};
  return { message: typeof body.error === 'string' ? body.error : undefined, body };
}

interface SendResult {
  ok: boolean;
  status: number;
  message?: string;
  data?: { _id?: string } | null;
  errorBody?: Record<string, unknown>;
}

/** One request with this device's session, renewed once if it had expired. */
async function fetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
  const withCreds = { ...init, credentials: 'include' as const, headers: { 'Content-Type': 'application/json' } };
  const res = await fetch(url, withCreds);
  if (res.status !== 401) return res;
  const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then((r) => r.ok).catch(() => false);
  return refreshed ? fetch(url, withCreds) : res;
}

async function sendDirect(write: QueuedWrite): Promise<SendResult> {
  // The envelope (bodyWithSync) is what lets the server catch a clash and
  // answer a retried create with the record that already exists.
  const body = bodyWithSync(write);
  const res = await fetchWithRefresh(`/api${write.endpoint}`, {
    method: write.method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return { ok: true, status: res.status, data: await res.json().catch(() => null) };
  const failure = await readFailure(res);
  return { ok: false, status: res.status, message: failure.message, errorBody: failure.body };
}

// FIFO, strictly sequential. A network failure or real server rejection
// stops the whole queue (per CLAUDE.md's "stop queue if sync fails, never
// skip") — but a data conflict on one record is isolated to that record and
// does NOT block unrelated queued writes behind it (user's explicit choice).
export async function processQueue(): Promise<void> {
  if (processing || !navigator.onLine) return;
  processing = true;
  // What this drain did, for the "back online" dialog (syncReport.ts).
  const report: SyncReportItem[] = [];
  try {
    // SEC-27. Read once per drain rather than per row: the signed-in user
    // cannot change mid-drain without a page load, and a load starts a fresh
    // drain anyway.
    const currentUserId = loadUserCache()?.id ?? null;
    const queue = await getQueue();
    for (const snapshot of queue) {
      // Re-read the row: an earlier row in this same drain may have just
      // rewritten its `pending-<id>` placeholders to real ids (completeWrite),
      // and the snapshot above would still hold the old body.
      const write = await getWrite(snapshot.id!);
      if (!write) continue; // discarded while this drain was running
      if (write.status === 'failed' || write.status === 'auth') break;
      if (write.status === 'conflict') continue; // already flagged, waiting on manual resolution — doesn't block others

      // SEC-27: someone else's unsynced work, or nobody signed in. HOLD it —
      // skip, never drop. `continue` rather than `break` for the same reason a
      // conflict does: a row waiting for its owner to sign in must not wedge
      // the writes of the person actually sitting here.
      if (!isOwnedBy(write, currentUserId)) continue;

      // Depends on a record that was created offline and has not synced yet.
      // FIFO normally guarantees the parent went first, so reaching here means
      // it is still waiting (held for its owner) or was discarded. Waiting: hold
      // this row too. Discarded: this write can never succeed, so say so rather
      // than leave it pending forever.
      if (hasUnresolvedPending(write)) {
        const parents = [...pendingRowIdsIn(write.endpoint), ...pendingRowIdsIn(write.body)];
        if (parents.some((id) => !queue.some((q) => q.id === id))) {
          await markFailed(write.id!, 'This change belongs to a record that was discarded before it synced, so it can no longer be saved. Discard this change too.');
          report.push({ ...describeWrite(write), status: 'failed', reason: 'Belongs to a record that was discarded.' });
          notifyQueueChange();
          break;
        }
        continue;
      }

      // BUG-03: claim the row before sending it. If another context (the
      // service worker, or another tab) already holds it, leave it alone — it
      // is mid-flight there, and sending it here is the duplicate.
      if (!(await claimWrite(write.id!, CONTEXT_ID))) continue;

      try {
        const result = await sendDirect(write);
        if (result.ok) {
          // A POST gave the record its real id: rewrite whatever was queued
          // against its placeholder, atomically with removing this row.
          if (write.method === 'POST') await completeWrite(write.id!, result.data?._id);
          else await removeFromQueue(write.id!);
          report.push({ ...describeWrite(write), status: 'synced' });
          notifyQueueChange();
        } else if (result.status === 409 && result.errorBody?.conflict === true) {
          // The SERVER held this edit back: someone else changed a field it would
          // overwrite after this device started. Decided in the same request that
          // would have written it, so nothing can slip between a check and a
          // write. Isolated to this record: it does not block the writes behind it.
          await markConflict(
            write.id!,
            (result.errorBody.current ?? {}) as Record<string, unknown>,
            typeof result.errorBody.conflictId === 'string' ? result.errorBody.conflictId : undefined,
          );
          await releaseClaim(write.id!);
          report.push({ ...describeWrite(write), status: 'conflict', reason: 'Someone else changed this record while you were offline.' });
          notifyQueueChange();
          continue;
        } else if (result.status === 401 || result.status === 403) {
          // The session expired while this device was offline and the refresh
          // token couldn't renew it. The write itself is perfectly valid, so
          // this is NOT a permanent failure — flag it as needing sign-in and
          // stop. Signing back in and hitting Retry will push it through.
          await markAuthRequired(write.id!, 'Your session expired — sign in again to sync this change.');
          await releaseClaim(write.id!);
          report.push({ ...describeWrite(write), status: 'auth', reason: 'Your session expired — sign in again to sync this change.' });
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
          report.push({ ...describeWrite(write), status: 'failed', reason: result.status === 404 ? 'The record was archived or removed while you were offline.' : result.message ?? `The server rejected this change (error ${result.status}).` });
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
    if (report.length > 0) notifySyncReport({ items: report, finishedAt: Date.now() });
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

// ── Conflict resolution (components/ConflictReviewDialog.tsx) ───────────────
// An edit the server held back lives on the server as a SyncConflict row; the
// choice is made THERE (so the audit trail and every other person's waiting
// edits stay consistent), and only then does this device drop its queued copy.

/** Tells the server what was decided. "Already resolved" (409) counts as done: the
 *  server no longer holds anything for this device to act on. */
async function resolveOnServer(conflictId: string, action: 'apply' | 'discard'): Promise<void> {
  const res = await fetchWithRefresh(`/api/sync-conflicts/${conflictId}/resolve`, { method: 'POST', body: JSON.stringify({ action }) });
  if (res.ok || res.status === 409) return;
  const failure = await readFailure(res);
  throw new Error(failure.message ?? `The server could not record that choice (error ${res.status}).`);
}

// "Use my version": the server writes this device's edit onto the record.
export async function keepMyChange(id: number): Promise<void> {
  const row = await getWrite(id);
  if (row?.serverConflictId) {
    await resolveOnServer(row.serverConflictId, 'apply');
    await removeFromQueue(id);
  } else {
    // Held before the server took over (client-side detection): force it through.
    await resolveConflictKeepMine(id);
  }
  notifyQueueChange();
  await processQueue();
}

// "Use the server version": this device's edit is dropped, the record stays as it is.
export async function discardMyChange(id: number): Promise<void> {
  const row = await getWrite(id);
  if (row?.serverConflictId) await resolveOnServer(row.serverConflictId, 'discard');
  await removeFromQueue(id);
  notifyQueueChange();
}

// "Use <someone else's> version": the server applies THEIR waiting edit, which
// supersedes this device's, so this device's copy is dropped.
export async function useOtherVersion(id: number, otherConflictId: string): Promise<void> {
  await resolveOnServer(otherConflictId, 'apply');
  await removeFromQueue(id);
  notifyQueueChange();
}

// The server already settled this (another person chose): nothing left to decide here.
export async function dismissResolvedConflict(id: number): Promise<void> {
  await removeFromQueue(id);
  notifyQueueChange();
}
