import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";

const dentalChartSchema = new mongoose.Schema({
  iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
  dentist_id: { type: mongoose.Schema.Types.ObjectId, ref: "Dentist", required: true },
  date_charted: { type: Date, required: true },

  // ── The VISIT this charting was done at (Sprint 149) ────────────────────
  //
  // ERD deviation. The dentist screens and treats at the SAME visit (user,
  // 2026-09-05), so a charting IS a visit's work: its findings and the
  // treatments done at it, on the same tooth records.
  //
  // ⚠ NULLABLE, and old rows stay null. Every chart created before this
  // belongs to no recorded visit, and the DOH report's date-based inference of
  // "1st / 2nd application" stays their fallback — the same way Sprint 147
  // kept the chart fallback for visits recorded before it. A chart saved from
  // the chart screen with no service ticked is also null: charting with no
  // visit attached is a real thing. (2026-09-25: the chart screen now SETS
  // this itself when a service is ticked -- see DentalChart.tsx's handleSave
  // -- rather than only reading it from a separate Record Visit flow, which
  // no longer exists.)
  preventive_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreventiveCareRecord", default: null },
  ...softDeleteFields,
});

// Sprint 91. `filterable: ["iptr_id"]`, and the join Sprints 88 and 90 walk:
// student -> IPTR -> charts -> tooth records.
dentalChartSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("DentalChart", dentalChartSchema);
