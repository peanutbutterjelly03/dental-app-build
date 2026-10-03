// Offline sync, server side. A device that edited a record while offline sends the
// values it STARTED from along with the edit:
//
//   PUT /students/:id   { section: "B", _sync: { operationId, base: { section: "A" } } }
//
// The server applies the edit only if nobody changed those fields in the meantime,
// and decides that in the SAME request that writes (loaded record in hand), not in
// a separate read the way the client used to. A read-then-write split across two
// requests cannot see a change that lands between them.
//
// Why "values it started from" and not an updated_at timestamp: most of these
// models carry no `updated_at` (STUDENT, STUDENT_IPTR, MEDICAL_HISTORY, TREATMENT,
// ... are `updatedAt: false`; DENTAL_CHART and TOOTH_RECORD have no timestamps at
// all), and adding one to ten models is a migration this does not need.
//
// PURE (no database): the rules are tested on their own.

export interface SyncEnvelope {
  /** A UUID minted when the change was queued on the device. Makes a retry of the
   *  same change recognisable (idempotent create, one conflict row per change). */
  operationId: string;
  /** The record's values, as the device last saw them, for the fields it changed. */
  base: Record<string, unknown>;
}

const OPERATION_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_BASE_KEYS = 100;

/** Removes `_sync` from a request body (it is never stored) and returns it, or
 *  null when absent or malformed: a bad envelope must not turn a normal save
 *  into an error, it just gets no conflict protection. */
export function takeSync(body: Record<string, unknown>): SyncEnvelope | null {
  const raw = body._sync;
  delete body._sync;
  if (!raw || typeof raw !== "object") return null;
  const { operationId, base } = raw as { operationId?: unknown; base?: unknown };
  if (typeof operationId !== "string" || !OPERATION_ID.test(operationId)) return null;
  const safeBase =
    base && typeof base === "object" && !Array.isArray(base) && Object.keys(base).length <= MAX_BASE_KEYS
      ? (base as Record<string, unknown>)
      : {};
  return { operationId, base: safeBase };
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

/** A value in one canonical form, so "2015-03-04" (what a form sends) and
 *  "2015-03-04T00:00:00.000Z" (what the database returns) compare equal. */
export function canon(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "string" && DATE_LIKE.test(value)) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? value : new Date(time).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = canon((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** The fields this edit would overwrite although someone else changed them since
 *  the device started: the server's value differs from what the device saw AND
 *  from what it is about to write. A field the device sent no starting value for
 *  cannot be judged, so it is never a conflict (same as before this existed).
 *  `current` must be a plain, decrypted copy of the stored record. */
export function conflictingFields(base: Record<string, unknown>, updates: Record<string, unknown>, current: Record<string, unknown>): string[] {
  return Object.keys(updates).filter(
    (key) =>
      Object.prototype.hasOwnProperty.call(base, key) &&
      !same(base[key], current[key]) &&
      !same(updates[key], current[key]),
  );
}
