import { SyncOperation } from "../models/index.js";

// A claim older than this is presumed dead (the request that took it crashed
// before finishing), so another attempt may take it over. Far longer than any
// create takes; short enough that a crash does not strand the change for long.
const STALE_CLAIM_MS = 2 * 60 * 1000;

/** The record a finished create made for this operation, if there is one. Checked
 *  FIRST on a create, before any validation: a replay must be answered with the
 *  original success, not run into its own duplicate guard (a student year record
 *  is unique per student and year, so replaying it would 409 against itself). */
export async function findFinishedOperation(operationId: string, ownerId: string): Promise<string | null> {
  // Owner-checked: an operation id is not a credential, but one user must never
  // be handed a record because they quoted another user's id.
  const op = (await SyncOperation.findOne({ operation_id: operationId, owner_id: ownerId, status: "done" }).lean()) as { record_id?: unknown } | null;
  return op?.record_id ? String(op.record_id) : null;
}

export type Claim = "new" | "busy" | "done";

/** Takes the claim for this operation, immediately before the create. The unique
 *  index on operation_id is what makes two simultaneous arrivals safe: exactly
 *  one insert succeeds. */
export async function claimOperation(operationId: string, ownerId: string, resource: string): Promise<{ state: Claim; recordId?: string }> {
  try {
    await SyncOperation.create({ operation_id: operationId, owner_id: ownerId, resource, status: "started", started_at: new Date() });
    return { state: "new" };
  } catch (err) {
    if ((err as { code?: number })?.code !== 11000) throw err;
  }
  const op = await SyncOperation.findOne({ operation_id: operationId });
  // Someone else's operation id: never answer with their record.
  if (!op || String(op.owner_id) !== ownerId) return { state: "busy" };
  if (op.status === "done" && op.record_id) return { state: "done", recordId: String(op.record_id) };
  const stale = Date.now() - new Date(op.started_at).getTime() > STALE_CLAIM_MS;
  if (op.status === "failed" || (op.status === "started" && stale)) {
    // Atomic take-over: only one contender flips it.
    const taken = await SyncOperation.findOneAndUpdate(
      { _id: op._id, $or: [{ status: "failed" }, { status: "started", started_at: op.started_at }] },
      { status: "started", started_at: new Date() },
    );
    if (taken) return { state: "new" };
  }
  return { state: "busy" };
}

export const markOperationDone = (operationId: string, recordId: unknown) =>
  SyncOperation.updateOne({ operation_id: operationId }, { status: "done", record_id: recordId });

export const markOperationFailed = (operationId: string) =>
  SyncOperation.updateOne({ operation_id: operationId }, { status: "failed" }).catch(() => undefined);
