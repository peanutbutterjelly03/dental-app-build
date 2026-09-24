import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const toothRecordSchema = new mongoose.Schema({
  chart_id: { type: mongoose.Schema.Types.ObjectId, ref: "DentalChart", required: true },
  tooth_number: { type: Number, required: true },
  condition: { type: String, maxlength: 100, required: true },
  treatment_code: { type: String, maxlength: 50 },
  // ERD DEVIATION, added 2026-09-25. Which RPC visit this tooth's CURRENT
  // treatment_code was recorded at -- one tooth still holds one current
  // condition/treatment (not a history), but now that Visit 1 and Visit 2
  // share the same DENTAL_CHART instead of getting their own, this is what
  // lets the Treatment Summary and the odontogram show "(V1)"/"(V2)" against
  // a tooth instead of the two visits' work being indistinguishable. NULL
  // for every tooth charted before this and for charting done outside the
  // RPC visit flow entirely -- not every tooth belongs to a visit.
  visit_number: { type: Number, enum: [1, 2, null], default: null },
  // Sprint J: a mis-charted tooth needs a retraction path. Without these the
  // only remedy was overwriting in place, which loses the original values.
  ...softDeleteFields,
});

// Sprint 91. `filterable: ["chart_id"]` — one chart's teeth. The heaviest
// child collection: up to 52 rows per chart, per year, per student.
toothRecordSchema.index({ isArchived: 1, chart_id: 1 });

export default getModel("ToothRecord", toothRecordSchema);
