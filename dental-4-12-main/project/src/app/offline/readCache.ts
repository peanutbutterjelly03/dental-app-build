// The per-user read cache: what lets Student Records, the Dental Chart and
// Treatment open with no connection, in ANY mode (it is plain IndexedDB, not the
// service worker, so it also works under `npm run dev`).
//
// Every successful read of an offline-module endpoint is stored under
// `<userId>|<path>`; when the network fails, apiClient.get answers from here.
// Keyed by the signed-in user (same id the write queue stamps, SEC-27), so a
// second person on a shared PC can never be handed the first one's records, and
// all of it is dropped at sign-out (clearOfflineReadCaches).
import { loadUserCache } from './authCache';
import { putReadCacheEntry, getReadCacheEntry, getReadCacheForOwner, type ReadCacheEntry } from './db';

// First path segment of the reads worth keeping. An ALLOWLIST: caching every GET
// would leave audit trails, user lists and reports (patient data the offline
// modules never show) sitting in the browser for nothing.
const CACHE_RESOURCES = new Set([
  'schools',
  'dentists',
  'config',
  'students',
  'student-iptrs',
  'medical-histories',
  'dietary-social-habits',
  'oral-health-conditions',
  'dental-charts',
  'tooth-records',
  'preventive-care-records',
  'treatments',
  'referrals',
  'appointments',
]);
const CACHE_STATS = new Set(['student-rows', 'student-nav', 'treatment-categories', 'treatment-count', 'risk-candidates', 'high-risk-count', 'rpc-rows']);

export function isCacheablePath(path: string): boolean {
  const [first, second] = path.split('?')[0].split('/').filter(Boolean);
  if (first === 'auth') return second === 'me';
  if (first === 'stats') return CACHE_STATS.has(second);
  return CACHE_RESOURCES.has(first);
}

/** A path naming a record that exists only on this device (`pending-<n>`). The
 *  server has never heard of it: asking would earn an error, so it is never sent. */
export const referencesPendingRecord = (path: string) => /pending-\d+/.test(path);

const ownerKey = (): string | null => loadUserCache()?.id ?? null;

export async function saveRead(path: string, data: unknown): Promise<void> {
  const owner = ownerKey();
  if (!owner || !isCacheablePath(path)) return;
  try {
    await putReadCacheEntry({ key: `${owner}|${path}`, ownerKey: owner, path, data, cachedAt: Date.now() });
  } catch {
    // Quota or private mode: caching is an optimisation; the read itself succeeded.
  }
}

export async function loadRead(path: string): Promise<ReadCacheEntry | undefined> {
  const owner = ownerKey();
  if (!owner) return undefined;
  try {
    return await getReadCacheEntry(`${owner}|${path}`);
  } catch {
    return undefined;
  }
}

/** The last SERVER copy of one record, looked up by id: its own cached read if
 *  there is one, otherwise inside any cached list of that resource. This is the
 *  baseline an offline edit is later checked against (conflict detection). */
export async function findCachedRecord(resource: string, id: string): Promise<Record<string, unknown> | undefined> {
  const owner = ownerKey();
  if (!owner) return undefined;
  try {
    const direct = await getReadCacheEntry(`${owner}|/${resource}/${id}`);
    if (direct?.data && typeof direct.data === 'object') return direct.data as Record<string, unknown>;
    for (const entry of await getReadCacheForOwner(owner)) {
      if (!entry.path.startsWith(`/${resource}?`) && entry.path !== `/${resource}`) continue;
      if (!Array.isArray(entry.data)) continue;
      const hit = (entry.data as Record<string, unknown>[]).find((r) => r._id === id);
      if (hit) return hit;
    }
  } catch {
    // No baseline: conflict detection simply will not apply to this write.
  }
  return undefined;
}
