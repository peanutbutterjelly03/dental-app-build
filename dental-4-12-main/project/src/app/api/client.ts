import { enqueueWrite, getQueue } from '../offline/db';
import { saveRead, loadRead, findCachedRecord, isCacheablePath, referencesPendingRecord } from '../offline/readCache';
import { applyPendingWrites, parsePath, OVERLAY_RESOURCES } from '../offline/overlay';
import { notifyQueueChange } from '../offline/queueEvents';
import { loadUserCache } from '../offline/authCache';

export class ApiError extends Error {
  status: number;
  /** The parsed error response, for the handful of errors that carry data the
   *  UI has to act on rather than just display — currently the duplicate-student
   *  409, whose `duplicates` array is what the "is this the same child?" dialog
   *  lists. Undefined when the response had no JSON body. */
  body?: Record<string, unknown>;
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Access tokens expire after 15 minutes (see server/utils/jwt.ts). Once
// requireAuth is enforced on every route, a 401 mid-session is expected
// behavior, not an error — transparently refresh once and retry rather than
// breaking the app or forcing a re-login every 15 minutes.
let refreshPromise: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (res.status === 401 && !isRetry && path !== "/auth/login" && path !== "/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Writes (POST/PUT/PATCH) queue to IndexedDB instead of failing when
// there's no network — per CLAUDE.md's PWA/OFFLINE spec (FIFO, synced when
// back online via queueProcessor.ts / Sprint 20's Workbox background sync).
// GET is never queued: there's nothing to sync, and a failed read should
// just fail so the UI can show cached/stale data as appropriate.
// /auth/* is never queued either — logging in/out/refreshing requires a
// real synchronous round trip (a JWT cookie can't be "synced later"); a
// queued login would look like it succeeded without ever authenticating
// anything. These just fail normally when offline, like a GET does.
// /predictions/* is a live RPC to the ML service, not a data write — a
// "synced later" risk prediction is meaningless, so it's never queued either.
// /twofa/ management is a live email round-trip (send code / confirm code) —
// queueing it offline would fake success without any code ever being sent.
// /school-year/* carries a password and starts a school year for real -- a
// "synced later" start, or a password replayed from storage, is never wanted.
function isNeverQueuedPath(path: string): boolean {
  return path.startsWith('/auth/') || path.startsWith('/predictions') || path.includes('/twofa/') || path.startsWith('/school-year');
}

// "View as" preview (utils/viewAs.ts): while the System Admin previews another
// role, every data write is refused HERE, before it can reach the server or
// the offline queue. /auth/* (log in/out), /predictions (a read-like model
// call) and /twofa/ are exempt: none of them writes a record.
let viewAsReadOnlyRole: string | null = null;
export function setViewAsReadOnly(roleLabel: string | null) {
  viewAsReadOnlyRole = roleLabel;
}

async function writeRequest<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<T> {
  if (viewAsReadOnlyRole && !isNeverQueuedPath(path)) {
    throw new ApiError(403, `You are viewing as ${viewAsReadOnlyRole}, a read-only preview. Exit View as to save changes.`);
  }
  if (isNeverQueuedPath(path)) {
    return request<T>(path, { method, body: body ? JSON.stringify(body) : undefined });
  }
  if (!navigator.onLine) {
    return queueWrite<T>(path, method, body);
  }
  try {
    return await request<T>(path, { method, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    // A real server rejection (validation error, 403, etc.) reached the
    // server and should surface normally — only an actual network failure
    // (fetch couldn't even complete) gets queued.
    if (err instanceof ApiError) throw err;
    return queueWrite<T>(path, method, body);
  }
}

// Best-effort snapshot of the record as this device last saw it, for PUT/PATCH
// conflict detection at sync time (see queueProcessor.ts): the last SERVER copy
// in the per-user read cache (offline/readCache.ts), never the overlaid one, so
// it is what the server had when this device last looked. Works fully offline.
// Returns undefined (no baseline, conflict detection just won't apply) for a
// record not cached yet, or one that exists only on this device.
async function captureBaselineSnapshot(path: string): Promise<Record<string, unknown> | undefined> {
  const match = path.match(/^\/([a-z-]+)\/([a-f0-9]{24})$/i);
  return match ? findCachedRecord(match[1], match[2]) : undefined;
}

// Best-effort — registers with the service worker's Background Sync so the
// queue can also drain if the tab gets closed while offline (Sprint 20),
// complementing (not replacing) Sprint 19's tab-open 'online' event trigger.
// No-ops silently where Background Sync isn't supported (e.g. Safari).
async function registerBackgroundSync(): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register('floral-queue-sync');
    }
  } catch {
    // Unsupported or registration failed — the online-event path still works.
  }
}

async function queueWrite<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown): Promise<T> {
  const baselineSnapshot = method === 'POST' ? undefined : await captureBaselineSnapshot(path);
  // SEC-27: stamp the owner at enqueue, so this write can only ever sync under
  // the account that made it. `authCache` is the right source — it is written
  // at login and cleared at logout, and it is readable synchronously here,
  // where there is no React context to ask.
  const userId = loadUserCache()?.id;
  const queued = await enqueueWrite({ endpoint: path, method, body, baselineSnapshot, userId });
  notifyQueueChange();
  registerBackgroundSync();
  // Synthetic optimistic response so calling code (which expects the
  // created/updated record back) can proceed normally. Real hooks merge
  // pending queue items into their lists using this same shape — see
  // hooks/useOfflineQueue.ts.
  return {
    ...(typeof body === 'object' && body ? body : {}),
    _id: `pending-${queued.id}`,
    _pending: true,
  } as T;
}

// Pending writes laid over a read (offline/overlay.ts). Skipped for anything that
// is not an offline-module record, so no extra IndexedDB read is paid there.
async function withPendingWrites(path: string, data: unknown): Promise<unknown> {
  const parsed = parsePath(path);
  if (!parsed || !OVERLAY_RESOURCES.includes(parsed.resource)) return data;
  try {
    return applyPendingWrites(path, data, await getQueue());
  } catch {
    return data;
  }
}

async function readFromCache<T>(path: string, networkError?: unknown): Promise<T> {
  const cached = await loadRead(path);
  if (!cached) {
    // A plain Error, not an ApiError: AuthContext reads "not an ApiError" as
    // "could not ask the server", which is what this is.
    throw networkError instanceof Error ? networkError : new Error("You're offline and this has not been opened on this device yet.");
  }
  return (await withPendingWrites(path, cached.data)) as T;
}

// Reads of the offline modules: network first, saved per user on success, and
// answered from that saved copy when the network is down. A real server answer
// (even an error) is never replaced by the cache.
async function read<T>(path: string): Promise<T> {
  // A record that exists only on this device (`pending-<n>`): the server has
  // never heard of it, so nothing is sent. It is built from the queued create.
  if (referencesPendingRecord(path)) {
    const out = await withPendingWrites(path, parsePath(path)?.kind === 'list' ? [] : undefined);
    if (out === undefined) throw new ApiError(404, 'Not found');
    return out as T;
  }
  if (!isCacheablePath(path)) return request<T>(path);
  if (!navigator.onLine) return readFromCache<T>(path);
  try {
    const data = await request<T>(path);
    void saveRead(path, data);
    return (await withPendingWrites(path, data)) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return readFromCache<T>(path, err);
  }
}

export const apiClient = {
  get: <T>(path: string) => read<T>(path),
  post: <T>(path: string, body?: unknown) => writeRequest<T>(path, "POST", body),
  put: <T>(path: string, body?: unknown) => writeRequest<T>(path, "PUT", body),
  patch: <T>(path: string, body?: unknown) => writeRequest<T>(path, "PATCH", body),
};

/** True when the write was queued on this device rather than saved on the
 *  server — queueWrite's synthetic response carries `_pending`. Callers use it
 *  to say "saved on this device" instead of "saved", and to skip a reload that
 *  would only read the stale cached copy. */
export function isQueuedResponse(response: unknown): boolean {
  return !!response && typeof response === 'object' && (response as { _pending?: boolean })._pending === true;
}

export const QUEUED_SAVE_MESSAGE = "Saved on this device. It will sync automatically when you're back online.";
