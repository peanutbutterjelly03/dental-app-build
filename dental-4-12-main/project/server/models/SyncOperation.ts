import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

// ERD deviation (2026-10-03). Bookkeeping, not clinical data: it makes a queued
// CREATE apply exactly once.
//
// Without it, a device that loses the connection AFTER the server saved a record
// but BEFORE the answer arrived keeps the change queued, sends it again, and the
// record exists twice (two tooth records for one tooth silently skew the DMF
// count). The device's `operationId` is claimed here before the create, so the
// second arrival finds the first and is handed the record that already exists.
//
// Holds no patient data, so nothing here is encrypted. Never hard deleted: rows
// are tiny and only written for changes that were queued offline.
const syncOperationSchema = new mongoose.Schema(
  {
    operation_id: { type: String, required: true, unique: true, maxlength: 64 },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resource: { type: String, required: true, maxlength: 40 },
    record_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    // started: a request holds the claim. done: the record exists. failed: the
    // create was refused or threw, so the same change may be tried again.
    status: { type: String, enum: ["started", "done", "failed"], default: "started" },
    started_at: { type: Date, default: Date.now },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

export default getModel("SyncOperation", syncOperationSchema);
