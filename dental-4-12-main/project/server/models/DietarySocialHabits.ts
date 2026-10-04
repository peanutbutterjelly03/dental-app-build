import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const dietarySocialHabitsSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    sugar_beverages: { type: Boolean, default: false },
    alcohol_drinker: { type: Boolean, default: false },
    tobacco_user: { type: Boolean, default: false },
    betel_nut_chewer: { type: Boolean, default: false },
    body_piercing: { type: Boolean, default: false },
    nail_biting: { type: Boolean, default: false },
    thumb_sucking: { type: Boolean, default: false },
    // Not in the original ERD — added 2026-09-04 alongside the same field on
    // MEDICAL_HISTORY/ORAL_HEALTH_CONDITION, all three gated behind an
    // "Others" chip on the History tab.
    others: { type: String, default: "" },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Sprint 91. `filterable: ["iptr_id"]`.
dietarySocialHabitsSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("DietarySocialHabits", dietarySocialHabitsSchema);
