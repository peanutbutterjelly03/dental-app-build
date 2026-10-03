// Unsynced changes, laid over a READ at read time.
//
// A write made offline is queued; nothing on the server has changed. For the page
// to look right (and to let someone keep charting) every read of the offline
// modules' records is answered as "what the server last said, plus what is still
// waiting in the queue", exactly as RAMHIS keeps `_syncStatus: 'pending'` rows
// next to the cached ones. Doing it at READ time, not by editing the cache, means
// the cache always holds server truth, a refresh can never overwrite a local edit,
// and a change disappears from the overlay by itself the moment it syncs.
//
// PURE (no IndexedDB): the rules are tested on their own.

/** Resources whose reads are overlaid. Deliberately NOT appointments or users:
 *  their hooks already merge their own pending rows, and overlaying them too
 *  would list every offline booking twice. */
export const OVERLAY_RESOURCES = [
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
];

export interface PendingRow {
  id?: number;
  endpoint: string;
  method: string;
  body: unknown;
}

type Rec = Record<string, unknown>;
const ID = '([0-9a-f]{24}|pending-\\d+)';
const SINGLE = new RegExp(`^/([a-z-]+)/${ID}$`, 'i');
const ARCHIVE = new RegExp(`^/([a-z-]+)/${ID}/archive$`, 'i');
const LIST = /^\/([a-z-]+)(?:\?(.*))?$/;
// Query parameters that shape a result without being a field on the record.
const META_PARAMS = new Set(['limit', 'offset', 'sort', 'includearchived', 'include_archived', 'q']);

export type ParsedPath =
  | { kind: 'single'; resource: string; id: string }
  | { kind: 'list'; resource: string; filters: Record<string, string[]> };

export function parsePath(path: string): ParsedPath | null {
  const single = SINGLE.exec(path);
  if (single) return { kind: 'single', resource: single[1], id: single[2] };
  const list = LIST.exec(path);
  if (!list) return null;
  const filters: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(list[2] ?? '')) {
    if (!META_PARAMS.has(key.toLowerCase())) filters[key] = value.split(',').filter(Boolean);
  }
  return { kind: 'list', resource: list[1], filters };
}

const bodyOf = (w: PendingRow): Rec => (w.body && typeof w.body === 'object' ? (w.body as Rec) : {});
const resourceOf = (endpoint: string) => endpoint.split('?')[0].split('/').filter(Boolean)[0] ?? '';
const pendingIdOf = (w: PendingRow) => `pending-${w.id}`;

function matches(record: Rec, filters: Record<string, string[]>): boolean {
  return Object.entries(filters).every(([key, values]) => record[key] !== undefined && values.includes(String(record[key])));
}

function created(w: PendingRow): Rec {
  return { ...bodyOf(w), _id: pendingIdOf(w), isArchived: false, _pending: true };
}

/** `data` is what the server (or the cache) returned — `undefined` when there is
 *  nothing, e.g. a record that only exists on this device. Returns the same shape
 *  with the pending writes applied. */
export function applyPendingWrites(path: string, data: unknown, queue: PendingRow[]): unknown {
  const parsed = parsePath(path);
  if (!parsed || !OVERLAY_RESOURCES.includes(parsed.resource)) return data;
  const rows = queue.filter((w) => resourceOf(w.endpoint) === parsed.resource);
  if (rows.length === 0) return data;
  const base = `/${parsed.resource}`;

  if (parsed.kind === 'list') {
    const items: Rec[] = Array.isArray(data) ? (data as Rec[]).map((r) => ({ ...r })) : [];
    for (const w of rows) {
      const endpoint = w.endpoint.split('?')[0];
      if (w.method === 'POST' && endpoint === base) {
        const record = created(w);
        if (matches(record, parsed.filters) && !items.some((r) => r._id === record._id)) items.push(record);
      } else if (ARCHIVE.test(endpoint)) {
        const id = endpoint.split('/')[2];
        const at = items.findIndex((r) => r._id === id);
        if (at >= 0) items.splice(at, 1);
      } else if ((w.method === 'PUT' || w.method === 'PATCH') && SINGLE.test(endpoint)) {
        const id = endpoint.split('/')[2];
        const at = items.findIndex((r) => r._id === id);
        if (at >= 0) items[at] = { ...items[at], ...bodyOf(w), _id: id, _pending: true };
      }
    }
    return items;
  }

  let record: Rec | undefined = data && typeof data === 'object' ? { ...(data as Rec) } : undefined;
  for (const w of rows) {
    const endpoint = w.endpoint.split('?')[0];
    if (w.method === 'POST' && endpoint === base && pendingIdOf(w) === parsed.id) record = created(w);
    else if ((w.method === 'PUT' || w.method === 'PATCH') && endpoint === `${base}/${parsed.id}` && record) {
      record = { ...record, ...bodyOf(w), _id: parsed.id, _pending: true };
    }
  }
  return record;
}
