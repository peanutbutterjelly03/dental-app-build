import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const studentIptrSchema = new mongoose.Schema(
  {
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    school_year: { type: String, maxlength: 20, required: true },
    // Sprint 57a. A student is Grade 3 this year and Grade 4 next year, but
    // STUDENT holds ONE grade_level/section — so every past IPTR silently
    // re-rendered with today's grade, and a past-year DOH report broken down
    // by grade was computed from grades nobody had at the time. The IPTR is
    // already the per-school-year container, so this is where a year-varying
    // value belongs, and "when do we update the grade?" answers itself: when
    // that year's IPTR is created.
    //
    // Optional on purpose. Records created before this sprint have no truthful
    // value to backfill (see migrateIptrGrades.ts — only the LATEST IPTR can be
    // filled honestly), and the UI says "not recorded" rather than inventing
    // one. STUDENT keeps its own grade_level/section as the CURRENT values,
    // which is what enrolment lists and the appointment roster want.
    grade_level: { type: String, default: null },
    section: { type: String, default: null },
    // Height and weight are year-varying in exactly the way grade is — a pupil
    // measured at 120 cm in Grade 3 is not 120 cm in Grade 6 — so they belong
    // on the per-year record, not on STUDENT (Sprint 68).
    //
    // BMI is deliberately NOT stored. It is a pure function of these two, and a
    // stored copy would drift the moment either is corrected — the same reason
    // age is derived rather than kept (Sprint 57b).
    //
    // Null when not measured. Nothing to backfill: the system has never
    // recorded either, so no migration accompanies this.
    height_cm: { type: Number, default: null, min: 0, max: 300 },
    weight_kg: { type: Number, default: null, min: 0, max: 500 },
    // Vitals recorded alongside height/weight at the screening (2026-09-05).
    // Not in the original Chapter 3 ERD — same precedent as the DENTAL_CHART
    // service fields. Temperature is CELSIUS; blood pressure stays a string
    // because it is a pair ("110/70"), not a number, and splitting it into
    // systolic/diastolic columns buys nothing this app ever queries on.
    temperature_c: { type: Number, default: null, min: 0, max: 45 },
    blood_pressure: { type: String, default: "" },
    // Consent must be renewed every school year, not given once for life —
    // a guardian's 2023 signature does not authorize treatment in 2026. It
    // used to live on STUDENT as a single lifetime flag; that's the same
    // "one grade for a multi-year student" bug Sprint 57a fixed, so it
    // moves to the same place by the same reasoning.
    //
    // Defaults to "pending" for every new year, including a freshly-added
    // one for a returning student — last year's "complete" never carries
    // forward. See migrateIptrConsent.ts for the one-time backfill of the
    // latest IPTR from the old STUDENT.consent_status value.
    consent_status: { type: String, enum: ["pending", "complete"], default: "pending" },
    // Set server-side by the pre('save') hook below whenever consent_status
    // changes — never trust a client-supplied timestamp for "when consent was
    // given". Cleared back to null the moment a "complete" is reverted to
    // "pending", since a pending record has no valid given date any more.
    consent_given_at: { type: Date, default: null },
    // The day this school year's record was opened for this student —
    // defaults to today at creation, and is editable afterward (2026-09-04)
    // via the year menu's password-gated Edit action, e.g. to correct a
    // year added late/backdated. Distinct from `created_at` (immutable
    // Mongoose timestamp) and from DENTAL_CHART's own `date_charted`
    // (when teeth were actually examined, not when the year record itself
    // was opened).
    date_opened: { type: Date, default: Date.now },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

studentIptrSchema.pre("save", function (next) {
  if (this.isModified("consent_status")) {
    this.consent_given_at = this.consent_status === "complete" ? new Date() : null;
  }
  next();
});

// Sprint 91. Leads with isArchived because every GET filters on it.
// One student's records for the IPTR screen — `filterable: ["student_id"]`
// (routes/index.ts), the read Sprint 48 measured at -92.6%.
studentIptrSchema.index({ isArchived: 1, student_id: 1 });
// The uniqueness check behind `uniqueBy: ["student_id", "school_year"]`, which
// runs on every create AND on every restore (Sprint 76). ⚠ That query carries
// NO isArchived — a restore must see archived rows — so the index above cannot
// serve it and this one is not redundant.
studentIptrSchema.index({ student_id: 1, school_year: 1 });

export default getModel("StudentIptr", studentIptrSchema);
