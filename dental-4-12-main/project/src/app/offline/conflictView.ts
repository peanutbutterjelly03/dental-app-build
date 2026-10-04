// The side-by-side a person reviews when a change they made offline collided with
// an edit made elsewhere (components/ConflictReviewDialog.tsx). Pure, so the
// comparison is tested on its own.
import { humanizeField, formatValue } from './describeWrite';

interface ConflictedWrite {
  body: unknown;
  /** The record as this device last saw it, when the change was made. */
  baselineSnapshot?: Record<string, unknown>;
  /** The record on the server now, captured when the sync found the clash. */
  conflictServerRecord?: Record<string, unknown>;
}

export interface ConflictField {
  field: string;
  /** What this device saved. */
  mine: string;
  /** What the server has now. */
  server: string;
  /** What the record said when this device started editing. */
  started: string | null;
  /** The server changed this field after this device started editing. */
  serverChanged: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields where this device's version and the server's now disagree,
 *  those the server changed under it first. A field both sides already agree on
 *  is not a decision for anyone, so it is left out. */
export function conflictFields(write: ConflictedWrite): ConflictField[] {
  const body = (write.body && typeof write.body === 'object' ? write.body : {}) as Record<string, unknown>;
  const server = write.conflictServerRecord ?? {};
  const baseline = write.baselineSnapshot;
  return Object.keys(body)
    .filter((key) => !key.startsWith('_') && !same(body[key], server[key]))
    .map((key) => ({
      field: humanizeField(key),
      mine: formatValue(body[key]),
      server: formatValue(server[key]),
      started: baseline ? formatValue(baseline[key]) : null,
      serverChanged: baseline ? !same(baseline[key], server[key]) : false,
    }))
    .sort((a, b) => Number(b.serverChanged) - Number(a.serverChanged));
}

/** Which record this is, in words, for the card heading: an edit carries only the
 *  fields that changed, so the name comes from the server copy. */
export function recordLabel(write: ConflictedWrite): string | null {
  const server = write.conflictServerRecord ?? {};
  const parts = [server.last_name, server.first_name].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return parts.length ? parts.join(', ') : null;
}

/** When the server copy was last changed, if the record carries it. */
export function serverChangedAt(write: ConflictedWrite): string | null {
  const at = write.conflictServerRecord?.updated_at ?? write.conflictServerRecord?.updatedAt;
  return typeof at === 'string' ? at : null;
}
