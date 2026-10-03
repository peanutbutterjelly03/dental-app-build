import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

const dentalAideSchema = new mongoose.Schema(
  {
    school_id: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
    last_name: { type: String, required: true },
    first_name: { type: String, required: true },
    contact_number: { type: String, maxlength: 20, required: true },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

dentalAideSchema.plugin(fieldEncryption, fieldEncryptionOptions(["contact_number"]));

export default getModel("DentalAide", dentalAideSchema);
