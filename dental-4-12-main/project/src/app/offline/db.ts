// Minimal IndexedDB wrapper for the offline write queue — no external
// dependency, this app only needs one object store with FIFO ordering.
// Safe to import from both the page and the service worker (Sprint 20's
// background sync handler runs the same queue logic in the SW context).
const DB_NAME = 'floral-offline';
const DB_VERSION = 1;
const STORE = 'writeQueue';

export interface QueuedWrite {
  id?: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  timestamp: number;
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
    };
    req.onsuccess = () => resolve(req.result);
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

// "Keep mine": force the queued write through despite the conflict, ignoring
// what changed on the server for the fields this write touches. Clears
// baselineSnapshot too — without that, the next processQueue() run would
// immediately re-run the conflict check against the same unchanged
// baseline and re-flag the exact same conflict again.
export function resolveConflictKeepMine(id: number): Promise<void> {
  return updateRecord(id, { status: 'pending', conflictServerRecord: undefined, baselineSnapshot: undefined });
}
