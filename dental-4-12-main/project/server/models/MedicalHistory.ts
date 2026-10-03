import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";
import { softDeleteFields } from "./shared/softDelete.js";

const medicalHistorySchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    allergies: { type: String, default: "" },
    diabetes_mellitus: { type: Boolean, default: false },
    hypertension: { type: Boolean, default: false },
    cardiovascular_disease: { type: Boolean, default: false },
    thyroid_disorders: { type: Boolean, default: false },
    hepatitis_disorders: { type: Boolean, default: false },
    malignancy: { type: Boolean, default: false },
    previous_hospitalization: { type: Boolean, default: false },
    previous_surgical: { type: Boolean, default: false },
    blood_transfusion: { type: Boolean, default: false },
    tattoo: { type: Boolean, default: false },
    others: { type: String, default: "" },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

medicalHistorySchema.plugin(fieldEncryption, fieldEncryptionOptions(["allergies", "others"]));

// Sprint 91. `filterable: ["iptr_id"]` — one IPTR's history, not the collection.
medicalHistorySchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("MedicalHistory", medicalHistorySchema);
