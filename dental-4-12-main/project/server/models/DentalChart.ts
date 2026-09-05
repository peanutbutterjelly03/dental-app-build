import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const dentalChartSchema = new mongoose.Schema({
  iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
  dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
  // The date the CONDITIONS were examined.
  date_charted: { type: Date, required: true },
  // The date TREATMENT was given (2026-09-05). Separate from date_charted on
  // purpose: a screening and the treatment that follows it are routinely
  // different visits, and one shared date forced the chart to claim they were
  // the same day. Nullable — a chart can record findings with nothing done yet.
  date_treated: { type: Date, default: null },
  // Per-VISIT services (added 2026-09-05). Not in the original Chapter 3 ERD —
  // same precedent as OralHealthCondition.orally_fit_child and
  // PreventiveCareRecord.facility_based, and it corrects a real modelling
  // error: these were previously recorded as TOOTH_RECORD.treatment_code, i.e.
  // once per tooth, when clinically they happen once per head. A fluoride
  // varnish application is one service for the whole mouth; storing it 28
  // times both overstated the service count and made "was varnish given?"
  // unanswerable without scanning every tooth. Per-TOOTH treatments (PFS, PF,
  // TF, X, SDF) stay on TOOTH_RECORD, where they belong.
  oral_examination: { type: Boolean, default: false },
  fluoride_varnish: { type: Boolean, default: false },
  oral_prophylaxis: { type: Boolean, default: false },
  consultation: { type: Boolean, default: false },
  treatment_others: { type: String, default: "" },
  ...softDeleteFields,
});

// Sprint 91. `filterable: ["iptr_id"]`, and the join Sprints 88 and 90 walk:
// student -> IPTR -> charts -> tooth records.
dentalChartSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("DentalChart", dentalChartSchema);
