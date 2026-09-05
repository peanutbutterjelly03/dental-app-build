import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const oralHealthConditionSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    oral_hygiene: { type: String, maxlength: 50, required: true },
    // Not in the original ERD — added 2026-09-04, the real DOH term used on
    // the Target Client List (TCL) report. This is the CLINICIAN'S per-visit
    // assessment on the chart, distinct from the TCL's own "Orally Fit
    // Child"/"Caries Free" columns, which are computed from tooth records.
    orally_fit_child: { type: Boolean, default: false },
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
