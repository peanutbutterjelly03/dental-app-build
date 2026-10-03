import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const preventiveCareRecordSchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    visit_date: { type: Date, required: true },
    visit_number: { type: Number, enum: [1, 2], required: true },
    // FHSIS Section D splits every band into `a` (facility-based) and `b`
    // (non-facility-based) sub-rows, and the paper Target Client List records
    // it per patient as "Facility Based 0/1". Default NULL, deliberately —
    // NOT false. Records seeded before Sprint 81 genuinely have no answer, and
    // defaulting them to non-facility would invent the split that FhsisReport
    // has so far refused to invent. Null reads as "not recorded" and the form
    // keeps saying so.
    facility_based: { type: Boolean, default: null },
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Sprint 91. `filterable: ["iptr_id"]` — the RPC visit lookup.
preventiveCareRecordSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("PreventiveCareRecord", preventiveCareRecordSchema);
