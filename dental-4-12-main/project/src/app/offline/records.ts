// Every student's chart data, kept record by record in IndexedDB, so a chart opens
// offline even if nobody ever opened it on this device (bulkSync.ts fills it).
//
// The ordinary read cache (readCache.ts) is keyed by URL and so can only replay a
// request it has already seen. This is keyed by RECORD and by the parent id each
// record is looked up by, so any request the chart page makes can be ANSWERED from
// it: `/student-iptrs?student_id=X`, `/tooth-records?chart_id=Y,Z`, `/students/X`.
//
// Pure rules (key shapes, which requests can be answered) are tested on their own.
import { loadUserCache } from './authCache';
import { getOfflineRecord, getOfflineRecordsByFk, type OfflineRecord } from './db';
import { parsePath } from './overlay';

/** The field each resource is looked up by (the server's `filterable`). */
export const FILTER_FIELDS: Record<string, string> = {
  'student-iptrs': 'student_id',
  'medical-histories': 'iptr_id',
  'dietary-social-habits': 'iptr_id',
  'oral-health-conditions': 'iptr_id',
  'dental-charts': 'iptr_id',
  'tooth-records': 'chart_id',
  'preventive-care-records': 'iptr_id',
  treatments: 'iptr_id',
  referrals: 'iptr_id',
};

/** Resources held record by record. */
export const RECORD_RESOURCES = ['students', ...Object.keys(FILTER_FIELDS)];

// What a list's filter id must be for the list to be TRUSTED. An empty answer is
// only honest if the parent is known: a student with no year records really has
// none, but a student this device never downloaded has an unknown number.
const PARENT_OF: Record<string, string> = { student_id: 'students', iptr_id: 'student-iptrs', chart_id: 'dental-charts' };

export const recordKey = (owner: string, resource: string, id: string) => `${owner}|${resource}|${id}`;
export const fkKey = (owner: string, resource: string, field: string, value: string) => `${owner}|${resource}|${field}|${value}`;

/** One downloaded record as it is stored; null for anything with no id. */
export function toOfflineRecord(owner: string, resource: string, data: unknown, run: string): OfflineRecord | null {
  const rec = data as Record<string, unknown> | null;
  const id = rec && typeof rec._id === 'string' ? rec._id : null;
  if (!id) return null;
  const field = FILTER_FIELDS[resource];
  const parent = field && rec ? rec[field] : undefined;
  return {
    key: recordKey(owner, resource, id),
    ownerKey: owner,
    resource,
    id,
    fk: typeof parent === 'string' ? [fkKey(owner, resource, field, parent)] : [],
    data,
    run,
  };
}

export type Plan =
  | { kind: 'single'; resource: string; id: string }
  | { kind: 'list'; resource: string; field: string; values: string[] };

/** Which requests can be answered from these records: one record by id, or a list
 *  filtered by exactly the field that resource is looked up by. Anything else
 *  (other filters, `pending-` ids, other resources) is not ours to answer. */
export function planFor(path: string): Plan | null {
  const parsed = parsePath(path);
  if (!parsed || !RECORD_RESOURCES.includes(parsed.resource)) return null;
  if (parsed.kind === 'single') return /^[0-9a-f]{24}$/i.test(parsed.id) ? { kind: 'single', resource: parsed.resource, id: parsed.id } : null;
  const field = FILTER_FIELDS[parsed.resource];
  const entries = Object.entries(parsed.filters);
  if (!field || entries.length !== 1 || entries[0][0] !== field) return null;
  const values = entries[0][1];
  return values.length > 0 && values.every((v) => /^[0-9a-f]{24}$/i.test(v)) ? { kind: 'list', resource: parsed.resource, field, values } : null;
}

/** Answers a request from the downloaded records, or undefined when it cannot be
 *  answered with confidence (so the caller fails honestly instead of showing
 *  "no records" for a student this device never downloaded). */
export async function deriveFromRecords(path: string): Promise<unknown | undefined> {
  const plan = planFor(path);
  const owner = loadUserCache()?.id;
  if (!plan || !owner) return undefined;
  try {
    if (plan.kind === 'single') return (await getOfflineRecord(recordKey(owner, plan.resource, plan.id)))?.data;
    const parent = PARENT_OF[plan.field];
    const rows: unknown[] = [];
    for (const value of plan.values) {
      if (!(await getOfflineRecord(recordKey(owner, parent, value)))) return undefined;
      for (const rec of await getOfflineRecordsByFk(fkKey(owner, plan.resource, plan.field, value))) rows.push(rec.data);
    }
    return rows;
  } catch {
    return undefined;
  }
}
