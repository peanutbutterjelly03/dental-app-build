import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

// ERD deviation (Sprint 127), like DENTIST_ROTATION and DAY_NOTE before it.
// Justified by a statutory form, not by a wish: the DOH Oral Health Program
// Report prints FIVE referral rows that had no source at all, so every one
// rendered "—" on a document the clinic files with the City Health Office.
//
// Parented on iptr_id (like TREATMENT), NOT student_id (like APPOINTMENT).
// A referral belongs to a school year the same way a treatment does, and the
// Referral Tracking table shows GRADE, which lives on STUDENT_IPTR since
// Sprint 57a. Going through the IPTR gets both for free.
const referralSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", default: null },

    // ⚠ THE ENUM IS THE DOH FORM'S OWN ROW LIST, not a taxonomy of our own.
    // Each row of the report is a count of exactly one value, which is what
    // lets those rows be filled without a judgement call at report time:
    //
    //   primary_care          → "No. of patients referred to other Primary Care Facilities"
    //   higher_level          → "Total no. of patients referred to Higher Level of Care"
    //   oral_cancer_screening → "a. No. of patients for Oral Cancer Screening Referrals"
    //   surgical              → "b. No. of patients for Surgical Procedures"
    //   private_facility      → "c. No. of Referrals to Private Facilities"
    //
    // ⚠ a/b/c are printed INDENTED UNDER the higher_level row. They are stored
    // as their own values and `higher_level` is counted as the SUM of itself
    // plus a+b+c (see useDohReportData) — so a referral for oral cancer
    // screening is tallied once in the total and once in its sub-row, exactly
    // as the paper form reads. Recording such a referral as `higher_level`
    // as well would double-count it.
    referral_type: {
      type: String,
      required: true,
      enum: ["primary_care", "higher_level", "oral_cancer_screening", "surgical", "private_facility"],
    },

    date_issued: { type: Date, required: true },

    // An institution, not patient PII — deliberately NOT encrypted, so it stays
    // queryable and groupable. `reason` below is the same class as
    // TREATMENT.diagnosis and is encrypted for the same reason.
    facility_name: { type: String, required: true, maxlength: 120 },
    reason: { type: String, required: true, maxlength: 500 },
    notes: { type: String, default: "", maxlength: 500 },

    // ISSUE-ONLY BY DESIGN (decided 2026-09-05). Whether a referral is ever
    // closed out — did the family actually go? — is unconfirmed with the
    // dentist, so these are present, defaulted and NOT required rather than
    // driving a follow-up workflow nobody has asked for. The Reports table's
    // status pills already expect exactly these three values.
    status: { type: String, enum: ["pending", "completed", "no-show"], default: "pending" },
    follow_up_date: { type: Date, default: null },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

referralSchema.plugin(fieldEncryption, fieldEncryptionOptions(["reason", "notes"]));

// Two reads exist: one student's referrals (`filterable: ["iptr_id"]`, the
// Referrals tab) and a date-bounded sweep for the reports (`dateField`).
referralSchema.index({ isArchived: 1, iptr_id: 1 });
referralSchema.index({ isArchived: 1, date_issued: 1 });

export default getModel("Referral", referralSchema);
