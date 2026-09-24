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
    // Required unless is_not_student (below) -- a person who isn't actually
    // enrolled has no grade/section worth demanding on this form. Sex is NOT
    // included in this exemption (stays plain `required: true` above): it
    // applies to a non-enrolled person the same as anyone else.
    grade_level: { type: String, required: [function (this: any) { return !this.is_not_student; }, "grade_level is required"] },
    section: { type: String, required: [function (this: any) { return !this.is_not_student; }, "section is required"] },
    // ERD DEVIATION, added 2026-09-25. A person entered through the Add
    // Student form who isn't actually enrolled at the school (e.g. a sibling
    // or community member treated at a Bayanihan mission) -- grade_level and
    // section don't apply, so this is the one case those two are allowed to
    // be missing (see the conditional `required` above). Defaults false:
    // every existing and newly-added real pupil is unaffected.
    is_not_student: { type: Boolean, default: false },
    // Not in the original ERD — added Sprint 14. Real DOH IPTR school
    // registration data, not UI-invented (same rationale as Sprint 11's
    // appointment_type addition).
    guardian_name: { type: String, default: "" },
    // ⚠ ADDED Sprint 174 because her Add Student form (taken whole in
    // 471f647c/de94d180) already had inputs for both, posting to /students —
    // and with no schema path Mongoose DROPPED them silently. An encoder typed
    // a place of birth, pressed Save, and it vanished with no error: exactly
    // the "control that appears to work must work" rule broken.
    //
    // Keeping the inputs rather than deleting them, because the PAPER IPTR
    // prints both, and the OCR module skips Occupation for the stated reason
    // that no model stores it — this closes that too.
    place_of_birth: { type: String, default: "" },
    guardian_occupation: { type: String, default: "" },
    guardian_contact: { type: String, default: "" },
    philhealth_number: { type: String, default: "" },
    philhealth_status: { type: String, enum: ["None", "Principal", "Dependent"], default: "None" },
    is_4ps: { type: Boolean, default: false },
    fourps_id: { type: String, default: "" },
    // ⚠ LEGACY as of Sprint 167 — consent is per school year now and lives on
    // STUDENT_IPTR. Nothing reads or writes this any more. The FIELD IS KEPT so
    // the existing values stay readable (never hard delete), and so
    // migrateIptrConsent.ts can carry them forward on any database that has not
    // been migrated yet. Do not start reading it again.
    consent_status: { type: String, enum: ["pending", "complete"], default: "pending" },
    // Marks a record created by a seeder rather than by a real encoding
    // session. Defaults to false, so anything a person creates — the Add
    // Student form, the CSV import, OCR — is real by default and can never be
    // caught by a purge. Only the seeders set it true.
    //
    // Added Sprint 117 because the ONLY thing separating demo from real data
    // was a hardcoded list of 26 names in demoStudents.ts, and the first real
    // hand-encoded record had just landed in the same database. That list had
    // already drifted once (Sprint 45 added eight pupils the purge's copy never
    // learned about), and Phase 3 adds 50 more real records.
    //
    // ⚠ DEVIATES from the Chapter 3 ERD — recorded in docs/DATA-MODEL.md; the
    // ERD figure itself is hand-edited and only the user can update it.
    is_demo: { type: Boolean, default: false },
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
  fieldEncryptionOptions(["full_name", "last_name", "first_name", "middle_name", "address", "contact_number", "guardian_name", "guardian_contact", "philhealth_number", "fourps_id", "place_of_birth", "guardian_occupation"]),
);

// Sprint 56. Both indexes lead with isArchived because every GET filters on it.
// Section roster — the appointment create form's grade/section picker.
studentSchema.index({ isArchived: 1, school_id: 1, grade_level: 1, section: 1 });
// Duplicate-at-entry prefilter (Sprint 47): school_id + birthday are the only
// plaintext parts of that check — the names it compares are encrypted, so they
// can only be matched in JS after this narrows the candidates.
studentSchema.index({ isArchived: 1, school_id: 1, birthday: 1 });

export default getModel("Student", studentSchema);
