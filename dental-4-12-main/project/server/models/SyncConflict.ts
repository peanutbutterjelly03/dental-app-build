import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

// ERD deviation (2026-10-03), like DENTIST_ROTATION, DAY_NOTE, REFERRAL and
// SCHOOL_YEAR_ROLLOVER before it. Not in Chapter 3.
//
// One row per OFFLINE EDIT that was held back because the record had been changed
// by someone else after the device started editing (utils/syncConflict.ts).
// The edit is not applied and not lost: it waits here, with who made it and when,
// until a person chooses (routes/syncConflictRoutes.ts). Several people's offline
// edits to the same record accumulate as several rows; "the conflict" for a record
// is simply its pending rows, and the SERVER version is always read live, never
// stored, so it can never be stale.
//
// ⚠ BOTH JSON COLUMNS ARE PATIENT DATA. They hold the very fields being edited
// (names, addresses, diagnoses), so they are encrypted exactly like the models
// they were copied from. They are strings, not objects, because
// mongoose-field-encryption encrypts string fields. Never log them.
//
// ⚠ NEVER hard deleted. A resolved row stays as `applied` or `discarded`: it is
// the record of who decided what about whose edit.
const syncConflictSchema = new mongoose.Schema(
  {
    // The model name of the record in conflict ("Student", "ToothRecord", ...).
    resource: { type: String, required: true, maxlength: 40 },
    record_id: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Minted on the device when the change was queued. Unique, so a retried PUT
    // finds its own row instead of adding a second one.
    operation_id: { type: String, required: true, unique: true, maxlength: 64 },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // JSON of the values the device started from, and of the fields it wants to write.
    base_json: { type: String, default: "{}", maxlength: 20000 },
    changes_json: { type: String, default: "{}", maxlength: 20000 },

    status: { type: String, enum: ["pending", "applied", "discarded"], default: "pending" },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolved_at: { type: Date, default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

syncConflictSchema.plugin(fieldEncryption, fieldEncryptionOptions(["base_json", "changes_json"]));

// The one read: a record's pending rows.
syncConflictSchema.index({ status: 1, resource: 1, record_id: 1 });

export default getModel("SyncConflict", syncConflictSchema);
