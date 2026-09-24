import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const oralHealthConditionSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    oral_hygiene: { type: String, maxlength: 50, required: true },
    gingivitis: { type: Boolean, default: false },
    periodontal_disease: { type: Boolean, default: false },
    debris: { type: Boolean, default: false },
    calculus: { type: Boolean, default: false },
    abnormal_growth: { type: Boolean, default: false },
    cleft_lip_palate: { type: Boolean, default: false },
    others: { type: String, default: "" },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Sprint 91. `filterable: ["iptr_id"]`.
oralHealthConditionSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("OralHealthCondition", oralHealthConditionSchema);
