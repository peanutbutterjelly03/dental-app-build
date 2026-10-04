import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

// ERD deviation (2026-10-01, Update School Year redesign). Not in the Chapter 3
// ERD; cite it as a deviation, like DAY_NOTE and REFERRAL.
//
// ONE collection, two kinds of row, told apart by `school_id`:
//   • school_id NULL  → the PLAN for that school year, shared by every school:
//     the date the System Admin has set for it to begin (`planned_start`).
//   • school_id SET   → ONE school's state for that school year:
//       requested → a dentist or aide asked the System Admin to start it early
//       declined  → the System Admin said no (the school's one request is spent)
//       started   → the year is open for this school, via `start_kind`:
//                   "all"   the System Admin started every school at once
//                   "early" the System Admin approved this school's request
//
// ⚠ `school_year` is the year being STARTED ("2027-2028"), not the one ending.
// STARTING = clearing STUDENT.grade_level/section after writing the outgoing
// year's values to that student's STUDENT_IPTR (see schoolYearController.ts).
// Until a school's row says "started", only a System Admin may create that
// year's STUDENT_IPTR (guardNextYearIptr), so the rule holds on the API and not
// just on the screen.
//
// One request per school per year is a property of the data, not of the UI:
// the unique index below means a second row cannot exist, and a declined row
// stays so (it is the record that the request was used).
const schoolYearRolloverSchema = new mongoose.Schema(
  {
    school_year: { type: String, maxlength: 20, required: true },
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
    status: { type: String, enum: ["planned", "requested", "declined", "started"], default: "planned" },
    planned_start: { type: Date, default: null },
    start_kind: { type: String, enum: ["all", "early", null], default: null },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requested_at: { type: Date, default: null },
    decided_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decided_at: { type: Date, default: null },
    started_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    started_at: { type: Date, default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

schoolYearRolloverSchema.index({ school_year: 1, school_id: 1 }, { unique: true });

export default getModel("SchoolYearRollover", schoolYearRolloverSchema);
