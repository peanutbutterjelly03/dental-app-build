import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const toothRecordSchema = new mongoose.Schema({
  chart_id: { type: mongoose.Schema.Types.ObjectId, ref: "DentalChart", required: true },
  tooth_number: { type: Number, required: true },
  condition: { type: String, maxlength: 100, required: true },
  treatment_code: { type: String, maxlength: 50 },
  // Sprint J: a mis-charted tooth needs a retraction path. Without these the
  // only remedy was overwriting in place, which loses the original values.
  ...softDeleteFields,
});

// Sprint 91. `filterable: ["chart_id"]` — one chart's teeth. The heaviest
// child collection: up to 52 rows per chart, per year, per student.
toothRecordSchema.index({ isArchived: 1, chart_id: 1 });

export default getModel("ToothRecord", toothRecordSchema);
