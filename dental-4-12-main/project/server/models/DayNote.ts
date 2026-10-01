import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

// ERD deviation (Sprint 108, like DENTIST_ROTATION before it). A note written
// against a DATE rather than a patient — "no clinic, holiday",
// "compressor down", "dentist at Annex A". The user asked for both this and a
// per-appointment remark and confirmed they are different things: a holiday is
// not a patient remark.
//
// ⚠ `school_id` IS NULLABLE ON PURPOSE: null means the note applies to EVERY
// school (a barangay-wide holiday). That is the whole reason the field is not
// required, and it is also the thing that makes the school-scope rule for this
// model different from every other — see schoolScope.ts.
//
// Not overloaded onto DENTIST_ROTATION.notes, which exists but is scoped to a
// school + dentist + WEEK. A week is not a day, and a holiday has no dentist.
const dayNoteSchema = new mongoose.Schema(
  {
    // Stored at midnight local so one calendar square maps to exactly one
    // date, and two notes written at different times of day collide as
    // intended rather than silently becoming two rows.
    date: { type: Date, required: true },
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
    note: { type: String, required: true, maxlength: 500 },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// The calendar asks for one month at a time, always filtering out archived
// rows first — the same shape Sprint 56 established for appointments.
dayNoteSchema.index({ isArchived: 1, date: 1 });

export default getModel("DayNote", dayNoteSchema);
