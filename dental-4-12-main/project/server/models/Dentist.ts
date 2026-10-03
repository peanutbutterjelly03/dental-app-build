import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const dentistSchema = new mongoose.Schema(
  {
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    last_name: { type: String, required: true },
    first_name: { type: String, required: true },
    license_number: { type: String, maxlength: 50, required: true },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export default getModel("Dentist", dentistSchema);
