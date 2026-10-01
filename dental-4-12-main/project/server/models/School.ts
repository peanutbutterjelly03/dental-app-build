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
    // Sprint 190 (user, 2026-09-30): the registry form no longer asks for type,
    // principal or a required street address, so those are optional. Old rows keep
    // their values; nothing is removed.
    school_nickname: { type: String },
    grade_from: { type: String },
    grade_to: { type: String },
    school_type: { type: String },
    principal_name: { type: String },
    street_address: { type: String },
    barangay: { type: String, required: true },
    city: { type: String, required: true },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export default getModel("School", schoolSchema);
