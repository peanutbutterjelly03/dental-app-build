// Minimal IndexedDB wrapper for the offline write queue — no external
// dependency, this app only needs one object store with FIFO ordering.
// Safe to import from both the page and the service worker (Sprint 20's
// background sync handler runs the same queue logic in the SW context).
//
// ⚠ "Safe to import from both" is doing a lot of work in that sentence, and it
// is what BUG-03 turned on: each context gets its own MODULE INSTANCE, so no
// variable in this file (or in queueProcessor) is shared between them. Only the
// database is. Anything that must be true across contexts therefore has to live
// on the ROW — see claimWrite.
import { isClaimable } from './queueRules';
import { pendingRowIdsIn, replacePendingId } from './idRemap';

const DB_NAME = 'floral-offline';
const DB_VERSION = 2;
const STORE = 'writeQueue';
// v2: the per-user read cache (readCache.ts). The write queue is untouched.
const READ_STORE = 'readCache';

export interface QueuedWrite {
  id?: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  timestamp: number;
  // Who enqueued this write (SEC-27, Sprint 159a). The queue drains on every
  // app load regardless of who is signed in, so without an owner one user's
  // offline work synced under the next user's session and the audit trail
  // recorded the wrong author. `undefined` on rows written before 159a — see
  // isOwnedBy for how those are handled.
  userId?: string;
  // Cross-context claim (BUG-03, Sprint 159a). The page and the service worker
  // are separate JS contexts with separate module instances, so a module-level
  // `processing` flag could not stop them draining the same queue at once. The
  // claim lives on the ROW, where both can see it.
  claimedAt?: number | null;
  claimedBy?: string | null;
  // 'auth' = the server refused it for authentication reasons (expired
  // session). Unlike 'failed' this IS retryable once the user signs back in —
  // the request itself is fine — so it is tracked separately.
  status: 'pending' | 'failed' | 'conflict' | 'auth';
  errorMessage?: string;
  // Best-effort snapshot of the record as this device last saw it (from the
  // GET-response cache), captured at enqueue time for PUT/PATCH only —
  // compared against the live server record at sync time to detect if
  // someone else changed the same fields while this device was offline.
  baselineSnapshot?: Record<string, unknown>;
  conflictServerRecord?: Record<string, unknown>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains(READ_STORE)) {
        const cache = db.createObjectStore(READ_STORE, { keyPath: 'key' });
        cache.createIndex('ownerKey', 'ownerKey');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app in another tab wants to upgrade this
      // database: step aside rather than block it forever.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueWrite(write: Omit<QueuedWrite, 'id' | 'timestamp' | 'status'>): Promise<QueuedWrite> {
  const db = await openDb();
  const record: QueuedWrite = { ...write, timestamp: Date.now(), status: 'pending' };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result as number });
    req.onerror = () => reject(req.error);
  });
}

export async function getWrite(id: number): Promise<QueuedWrite | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as QueuedWrite | undefined);
    req.onerror = () => reject(req.error);
  });
}

// FIFO order — oldest timestamp first, per CLAUDE.md's PWA/OFFLINE spec.
export async function getQueue(): Promise<QueuedWrite[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('timestamp').getAll();
    req.onsuccess = () => resolve(req.result as QueuedWrite[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function updateRecord(id: number, patch: Partial<QueuedWrite>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as QueuedWrite | undefined;
      if (!record) return resolve();
      const putReq = store.put({ ...record, ...patch });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export function markFailed(id: number, errorMessage: string): Promise<void> {
  return updateRecord(id, { status: 'failed', errorMessage });
}

export function markAuthRequired(id: number, errorMessage: string): Promise<void> {
  return updateRecord(id, { status: 'auth', errorMessage });
}

export function resetToPending(id: number): Promise<void> {
  return updateRecord(id, { status: 'pending', errorMessage: undefined, conflictServerRecord: undefined });
}

export function markConflict(id: number, serverRecord: Record<string, unknown>): Promise<void> {
  return updateRecord(id, { status: 'conflict', conflictServerRecord: serverRecord });
}

/**
 * Try to claim a row for sending. Returns true only if this context got it.
 *
 * ⚠ THE WHOLE POINT IS THAT THE READ AND THE WRITE SHARE ONE TRANSACTION.
 * `updateRecord` above cannot be reused: it opens a transaction, and a
 * check-then-act split across two transactions is exactly the race this fixes
 * (BUG-03). IndexedDB serialises overlapping readwrite transactions on the same
 * store, so two contexts calling this at the same instant cannot both win.
 */
export async function claimWrite(id: number, contextId: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as QueuedWrite | undefined;
      if (!record) return resolve(false);
      if (!isClaimable(record, contextId, Date.now())) return resolve(false);
      const putReq = store.put({ ...record, claimedAt: Date.now(), claimedBy: contextId });
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Hand a row back without sending it — used when a send fails, so a retry is
 *  not blocked for a whole lease period. A crash skips this, which is what the
 *  lease is for. */
export function releaseClaim(id: number): Promise<void> {
  return updateRecord(id, { claimedAt: null, claimedBy: null });
}

// "Keep mine": force the queued write through despite the conflict, ignoring
// what changed on the server for the fields this write touches. Clears
// baselineSnapshot too — without that, the next processQueue() run would
// immediately re-run the conflict check against the same unchanged
// baseline and re-flag the exact same conflict again.
export function resolveConflictKeepMine(id: number): Promise<void> {
  return updateRecord(id, { status: 'pending', conflictServerRecord: undefined, baselineSnapshot: undefined });
}

/**
 * A queued POST just succeeded and the server gave the record its real id.
 * Deletes the row AND rewrites every later row that points at its
 * `pending-<id>` placeholder, in ONE transaction.
 *
 * ⚠ ONE TRANSACTION, because the two halves are unsafe apart. Delete first and
 * a crash before the rewrite leaves dependants pointing at an id that no longer
 * resolves; rewrite first and a crash before the delete re-sends the parent,
 * creating the student or chart twice.
 */
export async function completeWrite(rowId: number, realId: string | undefined): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(rowId);
    if (realId) {
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const row = cursor.value as QueuedWrite;
        const refs = [...pendingRowIdsIn(row.endpoint), ...pendingRowIdsIn(row.body)];
        if (refs.includes(rowId)) {
          cursor.update({
            ...row,
            endpoint: replacePendingId(row.endpoint, rowId, realId),
            body: replacePendingId(row.body, rowId, realId),
          });
        }
        cursor.continue();
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ── Per-user read cache (offline/readCache.ts) ─────────────────────────────
export interface ReadCacheEntry {
  /** `<ownerKey>|<path>` */
  key: string;
  ownerKey: string;
  path: string;
  data: unknown;
  cachedAt: number;
}

export async function putReadCacheEntry(entry: ReadCacheEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READ_STORE, 'readwrite');
    tx.objectStore(READ_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getReadCacheEntry(key: string): Promise<ReadCacheEntry | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(READ_STORE, 'readonly').objectStore(READ_STORE).get(key);
    req.onsuccess = () => resolve(req.result as ReadCacheEntry | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Every cached read belonging to one user. */
export async function getReadCacheForOwner(ownerKey: string): Promise<ReadCacheEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(READ_STORE, 'readonly').objectStore(READ_STORE).index('ownerKey').getAll(ownerKey);
    req.onsuccess = () => resolve(req.result as ReadCacheEntry[]);
    req.onerror = () => reject(req.error);
  });
}

/** Sign-out on a shared PC: drop every user's cached reads. The write QUEUE is
 *  deliberately left alone — unsynced work stays with its owner. */
export async function clearReadCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READ_STORE, 'readwrite');
    tx.objectStore(READ_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
