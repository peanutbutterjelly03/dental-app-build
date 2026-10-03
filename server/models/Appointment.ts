import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const appointmentSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
  appointment_datetime: { type: Date, required: true },
  status: { type: String, maxlength: 50, required: true },
  // Not in the original ERD — added Sprint 11, see CLAUDE.md APPOINTMENT entry.
  appointment_type: { type: String, maxlength: 50, required: true },
  requires_followup: { type: Boolean, default: false },
  parental_supervision_required: { type: Boolean, default: false },
  ...softDeleteFields,
});

// Sprint 56 — the first index in this codebase. Every GET filters
// `isArchived: false` first and the appointments list now bounds by date, so
// this is the exact shape of the query. Without it the date bound only moves
// the full-collection scan from the browser to the server; with it, neither
// happens. Leading field is isArchived because it is on every query, including
// the ones that carry no date range.
appointmentSchema.index({ isArchived: 1, appointment_datetime: 1 });

export default getModel("Appointment", appointmentSchema);
