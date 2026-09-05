import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const schoolSchema = new mongoose.Schema(
  {
    school_name: { type: String, required: true },
    school_type: { type: String, required: true },
    principal_name: { type: String, required: true },
    street_address: { type: String, required: true },
    barangay: { type: String, required: true },
    city: { type: String, required: true },
    // Not in the original ERD. The "Start New School Year" clear on Update
    // School Year is normally only clickable March-August; a System Admin
    // flips this per school to let the dentist/dental_aide run it any time
    // (e.g. an early transfer, a correction after the season closed).
    allow_school_year_override: { type: Boolean, default: false },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export default getModel("School", schoolSchema);
