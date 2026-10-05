// Offline-created records get a placeholder id, `pending-<queue row id>` (see
// queueWrite in api/client.ts). Anything saved afterwards that points at such a
// record — a student's year record, a chart's tooth records — carries that
// placeholder in its body or endpoint, and the server has never heard of it.
//
// Kept as PURE functions (no IndexedDB) so the rules are testable on their own;
// db.ts applies them to the queue inside one transaction.

const PENDING_ID = /pending-(\d+)/g;

/** The queue row ids referenced by placeholders anywhere in `value`
 *  (strings, nested objects and arrays). */
export function pendingRowIdsIn(value: unknown): number[] {
  const found = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(PENDING_ID)) found.add(Number(m[1]));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  return [...found];
}

/** Returns a copy of `value` with every `pending-<rowId>` replaced by `realId`.
 *  The digit lookahead matters: replacing `pending-7` must not touch `pending-71`. */
export function replacePendingId<T>(value: T, rowId: number, realId: string): T {
  const token = new RegExp(`pending-${rowId}(?!\\d)`, 'g');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(token, realId);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/** Does this queued write still point at a placeholder that has not been
 *  resolved to a real id yet? */
export function hasUnresolvedPending(write: { endpoint: string; body: unknown }): boolean {
  return pendingRowIdsIn(write.endpoint).length > 0 || pendingRowIdsIn(write.body).length > 0;
}
