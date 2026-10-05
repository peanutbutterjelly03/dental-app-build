// Session-lived cache for the handful of GET endpoints that are genuinely
// expensive server-side, not client-side (user, 2026-09-27). /stats/student-
// rows and /stats/student-nav both run Student.find() with NO projection --
// required so mongoose-field-encryption's decryption markers survive (see
// CLAUDE.md's DATA ENCRYPTION section) -- which means every one of the ~12
// encrypted fields on every matching student is decrypted on every request.
// At real scale that is the actual bottleneck, and it was being paid again
// on every mount: opening Student Records, then a Dental Chart, then going
// back, each re-ran the same full decrypt. This cache makes repeat mounts
// within the session free; a real change (add/archive/edit a student) still
// gets seen because the mutating call sites force-bypass it (see
// useStudents.ts's `reload`) -- the TTL below is only a safety net for a
// mutation path that forgets to.
const TTL_MS = 2 * 60 * 1000;

interface Entry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

const cache = new Map<string, Entry<unknown>>();

/** Returns the cached promise for `key` if still fresh, otherwise calls
 *  `fetcher()`, caches ITS promise (so concurrent callers within the same
 *  tick share one network request), and returns that. A rejected fetch is
 *  evicted immediately so the next call retries instead of caching a
 *  failure. */
export function cachedGet<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
  const promise = fetcher().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { promise, expiresAt: now + TTL_MS });
  return promise;
}

/** Force-bypasses the cache for `key`: fetches fresh and re-primes the
 *  cache with the new result (so the next unrelated mount's cachedGet sees
 *  the fresh data too, not just this caller). Used after a write that
 *  changes what the cached endpoint would return. */
export function refreshCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  cache.delete(key);
  return cachedGet(key, fetcher);
}

/** Drops a cached entry without refetching -- for a write whose caller has
 *  no need for the fresh data itself, just wants the NEXT mount to see it. */
export function invalidateCached(key: string): void {
  cache.delete(key);
}
