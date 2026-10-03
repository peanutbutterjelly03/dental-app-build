import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";

const auditTrailSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, maxlength: 100, required: true },
  timestamp: { type: Date, default: Date.now, required: true },
  affected_record_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  affected_model: { type: String, maxlength: 50, required: true },
});

// Sprint 92. Sprint 91 deliberately left this collection unindexed, and was
// right at the time: nothing narrowed it, so an index would have been pure
// write cost. Bounding the route on `timestamp` creates the query shape that
// justifies one. Descending because every read wants the most recent first.
// ⚠ No isArchived here — AuditTrail is the one model without soft delete,
// deliberately: an audit record that can be archived is not an audit record.
auditTrailSchema.index({ timestamp: -1 });

export default getModel("AuditTrail", auditTrailSchema);
