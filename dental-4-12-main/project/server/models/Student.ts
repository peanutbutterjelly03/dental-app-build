import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

const studentSchema = new mongoose.Schema(
  {
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    // The DOH IPTR paper form has separate name boxes, and reports/lists are
    // ordered by surname, which a single string cannot support. `full_name`
    // stays as the canonical display value so every existing reader keeps
    // working — it is DERIVED from the parts below by the pre-save hook, so
    // the parts are the single source of truth and the two cannot drift.
    full_name: { type: String, maxlength: 150 },
    last_name: { type: String, maxlength: 60, required: true },
    first_name: { type: String, maxlength: 60, required: true },
    middle_name: { type: String, maxlength: 60, default: "" },
    birthday: { type: Date, required: true },
    sex: { type: String, maxlength: 10, required: true },
    address: { type: String, maxlength: 200, required: true },
    contact_number: { type: String, maxlength: 15 },
    grade_level: { type: String, required: true },
    section: { type: String, required: true },
    // Not in the original ERD — added Sprint 14. Real DOH IPTR school
    // registration data, not UI-invented (same rationale as Sprint 11's
    // appointment_type addition).
    guardian_name: { type: String, default: "" },
    guardian_contact: { type: String, default: "" },
    philhealth_number: { type: String, default: "" },
    philhealth_status: { type: String, enum: ["None", "Principal", "Dependent"], default: "None" },
    is_4ps: { type: Boolean, default: false },
    fourps_id: { type: String, default: "" },
    // consent_status moved to STUDENT_IPTR — consent is per school year, not
    // a lifetime flag. See StudentIptr.ts and migrateIptrConsent.ts.
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Registered BEFORE the encryption plugin on purpose: mongoose runs pre('save')
// hooks in registration order, so full_name is rebuilt from the parts while it
// is still plaintext and only then encrypted. Registering it after the plugin
// would write a plaintext full_name over the encrypted one.
studentSchema.pre("save", function (this: any, next) {
  const parts = [this.first_name, this.middle_name, this.last_name]
    .map((p: unknown) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  if (parts.length) this.full_name = parts.join(" ");
  next();
});

studentSchema.plugin(
  fieldEncryption,
  // The name parts are patient PII exactly as full_name is, so they carry the
  // same encryption. Sprint 26 random-IV rule applies: plaintext equality
  // queries on these fields NEVER match — fetch and filter in JS instead.
  fieldEncryptionOptions(["full_name", "last_name", "first_name", "middle_name", "address", "contact_number", "guardian_name", "guardian_contact", "philhealth_number", "fourps_id"]),
);

// Sprint 56. Both indexes lead with isArchived because every GET filters on it.
// Section roster — the appointment create form's grade/section picker.
studentSchema.index({ isArchived: 1, school_id: 1, grade_level: 1, section: 1 });
// Duplicate-at-entry prefilter (Sprint 47): school_id + birthday are the only
// plaintext parts of that check — the names it compares are encrypted, so they
// can only be matched in JS after this narrows the candidates.
studentSchema.index({ isArchived: 1, school_id: 1, birthday: 1 });

export default getModel("Student", studentSchema);
