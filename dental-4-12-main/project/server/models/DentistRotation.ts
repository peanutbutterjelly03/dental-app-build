import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

// Not in the original ERD — added Sprint 11 per CLAUDE.md's appointment
// scheduling module (dentist rotation per school).
const dentistRotationSchema = new mongoose.Schema(
  {
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
    week_start: { type: Date, required: true },
    week_end: { type: Date, required: true },
    notes: { type: String, default: "" },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

export default getModel("DentistRotation", dentistRotationSchema);
