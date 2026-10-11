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

  // ── The VISIT this charting was done at (Sprint 149) ────────────────────
  //
  // ERD deviation. The dentist screens and treats at the SAME visit (user,
  // 2026-09-05), so a charting IS a visit's work: its findings and the
  // treatments done at it, on the same tooth records.
  //
  // ⚠ NULLABLE, and old rows stay null. Every chart created before this
  // belongs to no recorded visit, and the DOH report's date-based inference of
  // "1st / 2nd application" stays their fallback — the same way Sprint 147
  // kept the chart fallback for visits recorded before it. A chart created
  // from the chart screen rather than from Record Visit is also null:
  // charting with no visit attached is a real thing.
  preventive_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreventiveCareRecord", default: null },
  ...softDeleteFields,
});

// Sprint 91. `filterable: ["iptr_id"]`, and the join Sprints 88 and 90 walk:
// student -> IPTR -> charts -> tooth records.
dentalChartSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("DentalChart", dentalChartSchema);
