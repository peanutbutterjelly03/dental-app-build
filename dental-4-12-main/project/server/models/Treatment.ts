import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";

const treatmentSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
    diagnosis: { type: String, required: true },
    treatment_done: { type: String, required: true },
    remarks: { type: String, default: "" },
    date: { type: Date, required: true },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

treatmentSchema.plugin(fieldEncryption, fieldEncryptionOptions(["diagnosis", "treatment_done"]));

// Sprint 91. `filterable: ["iptr_id"]`.
treatmentSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("Treatment", treatmentSchema);
