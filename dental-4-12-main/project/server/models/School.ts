import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const schoolSchema = new mongoose.Schema(
  {
    school_name: { type: String, required: true },
    // ⚠ Lets a System Admin open the next school year for THIS school outside the
    // normal March–August window (Sprint 183). Her UpdateSchoolYear page has
    // offered this since the shell adoption and told the user "a System Admin can
    // enable it from School Management" — but the field did not exist here, so
    // nothing could turn it on and the button was permanently dead. Default false:
    // the window is the rule, this is the documented exception.
    allow_school_year_override: { type: Boolean, default: false },
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
