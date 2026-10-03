import { enqueueWrite } from '../offline/db';
import { notifyQueueChange } from '../offline/queueEvents';

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
function isNeverQueuedPath(path: string): boolean {
  return path.startsWith('/auth/') || path.startsWith('/predictions') || path.includes('/twofa/');
}

async function writeRequest<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<T> {
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

// Best-effort snapshot of the record as this device last saw it, for
// PUT/PATCH conflict detection at sync time (see queueProcessor.ts). Reads
// from the Cache Storage the service worker's NetworkFirst /api/* caching
// populates — works fully offline since Cache Storage is local. Tries the
// exact by-id URL first, then falls back to scanning the parent list
// endpoint's cached response for a matching _id. Returns undefined (no
// baseline, conflict detection just won't apply) if nothing's cached yet.
async function captureBaselineSnapshot(path: string): Promise<Record<string, unknown> | undefined> {
  if (!('caches' in globalThis)) return undefined;
  try {
    const cache = await caches.open('api-cache');
    const direct = await cache.match(`/api${path}`);
    if (direct) return await direct.json();

    const idMatch = path.match(/^(\/[a-z-]+)\/([a-f0-9]{24})$/i);
    if (idMatch) {
      const [, listPath, id] = idMatch;
      const listRes = await cache.match(`/api${listPath}`);
      if (listRes) {
        const list = await listRes.json();
        if (Array.isArray(list)) return list.find((r: Record<string, unknown>) => r._id === id);
      }
    }
  } catch {
    // Cache API unavailable — no baseline, conflict detection skipped for this write.
  }
  return undefined;
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
  const queued = await enqueueWrite({ endpoint: path, method, body, baselineSnapshot });
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

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => writeRequest<T>(path, "POST", body),
  put: <T>(path: string, body?: unknown) => writeRequest<T>(path, "PUT", body),
  patch: <T>(path: string, body?: unknown) => writeRequest<T>(path, "PATCH", body),
};
