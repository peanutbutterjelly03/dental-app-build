import mongoose from "mongoose";
import { fieldEncryption } from "mongoose-field-encryption";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

const appointmentSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
  appointment_datetime: { type: Date, required: true },
  status: { type: String, maxlength: 50, required: true },
  // Not in the original ERD — added Sprint 11, see CLAUDE.md APPOINTMENT entry.
  // 200: the create form lets several type pills be picked and joins them with
  // ", " into one string (e.g. "Regular Checkup, Screening, Bayanihan
  // Mission..."), so 50 rejected any multi-pick submission past two short
  // types. Longest single label ("Bayanihan Mission") is 18 chars; 200 covers
  // all 7 types picked at once (~130 chars) with headroom.
  appointment_type: { type: String, maxlength: 200, required: true },
  requires_followup: { type: Boolean, default: false },
  parental_supervision_required: { type: Boolean, default: false },
  // ERD deviation, added 2026-09-25. Who the clinic can actually reach about
  // THIS booking — required, since an appointment nobody can be reached about
  // is exactly the "parental supervision" gap module 4 exists to flag.
  // Encrypted like STUDENT.guardian_contact and .contact_number: it is the
  // same class of PII (a phone number), just recorded per-visit instead of
  // per-pupil.
  guardian_contact_number: { type: String, maxlength: 30, required: true },
  // ERD deviation (Sprint 109). A remark about THIS pupil's slot — "bring
  // guardian", "reschedule, absent". Distinct from a DAY_NOTE, which is about
  // the date itself: the user confirmed the two are different things, so a
  // holiday does not live here and a patient remark does not live there.
  // Optional with an empty default, so no migration is needed.
  notes: { type: String, maxlength: 500, default: "" },
  ...softDeleteFields,
});

appointmentSchema.plugin(fieldEncryption, fieldEncryptionOptions(["guardian_contact_number"]));

// Sprint 56 — the first index in this codebase. Every GET filters
// `isArchived: false` first and the appointments list now bounds by date, so
// this is the exact shape of the query. Without it the date bound only moves
// the full-collection scan from the browser to the server; with it, neither
// happens. Leading field is isArchived because it is on every query, including
// the ones that carry no date range.
appointmentSchema.index({ isArchived: 1, appointment_datetime: 1 });

export default getModel("Appointment", appointmentSchema);
