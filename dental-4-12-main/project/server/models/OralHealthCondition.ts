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
    // ERD DEVIATION, added 2026-09-25. The DOH IPTR prints an "Orally Fit
    // Child" row (caries-free or every caries treated, no debris, no gum
    // pathology) that this model had no field for — the printed summary left
    // it permanently blank because deriving it from conditions would publish
    // a clinical verdict the dentist never actually gave. This is that
    // missing field: the dentist's own explicit judgment call, not a
    // derivation. Unrelated to Dashboard/Reports' separate "Orally Fit"
    // indicator (risk === "Low") — same name, different definition, kept
    // deliberately apart per the comment on that derivation.
    orally_fit_child: { type: Boolean, default: false },
    others: { type: String, default: "" },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Sprint 91. `filterable: ["iptr_id"]`.
oralHealthConditionSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("OralHealthCondition", oralHealthConditionSchema);
