import { AuditTrail } from "../models/index.js";

// Fire-and-forget: an audit logging failure should never break the actual
// user-facing operation it's logging.
export async function logAudit(userId: string, action: string, affectedRecordId: string, affectedModel: string) {
  try {
    await AuditTrail.create({
      user_id: userId,
      action,
      timestamp: new Date(),
      affected_record_id: affectedRecordId,
      affected_model: affectedModel,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
