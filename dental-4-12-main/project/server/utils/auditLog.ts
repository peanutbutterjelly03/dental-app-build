import { AuditTrail } from "../models/index.js";

// Fire-and-forget: an audit logging failure should never break the actual
// user-facing operation it's logging.
// ⚠ AUDIT_TRAIL.action has `maxlength: 100`. A longer action used to fail
// validation here and, because this function swallows errors on purpose, the
// entry silently never existed (found 2026-10-01: a dentist's risk review left
// no audit row at all). Trim instead: a shortened entry is recorded, a missing
// one is not.
const MAX_ACTION = 100;

export async function logAudit(userId: string, action: string, affectedRecordId: string, affectedModel: string) {
  try {
    await AuditTrail.create({
      user_id: userId,
      action: action.length > MAX_ACTION ? `${action.slice(0, MAX_ACTION - 1)}…` : action,
      timestamp: new Date(),
      affected_record_id: affectedRecordId,
      affected_model: affectedModel,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
