import mongoose from "mongoose";
import { fieldEncryption } from "mongoose-field-encryption";
import { getModel } from "./shared/getModel.js";
import { softDeleteFields } from "./shared/softDelete.js";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";
// The ONE list of skip reasons, shared with the review popup (a fixed list: a
// chosen reason holds no patient detail, so it needs no encryption).
import { SKIP_REASONS } from "../../shared/riskTreatments.js";

// ⚠ ERD DEVIATION (2026-10-01, Risk Classification redesign): model_risk_level,
// model_confidence, dentist_notes and treatment_decisions are not in the
// Chapter 3 ERD. They exist because a SUGGESTION is now stored (validated_by_
// dentist: false) and the dentist's review updates it, so the row must keep
// what the system said apart from what the dentist decided. Cite as a deviation.
const treatmentDecisionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, maxlength: 10 },
    /** FDI tooth number; null for a whole-mouth treatment (Fluoride Varnish). */
    tooth: { type: Number, default: null },
    decision: { type: String, enum: ["accepted", "skipped"], required: true },
    skip_reason: { type: String, enum: [...SKIP_REASONS, null], default: null },
  },
  { _id: false },
);

const riskStratificationSchema = new mongoose.Schema({
  preventive_id: { type: mongoose.Schema.Types.ObjectId, ref: "PreventiveCareRecord", required: true },
  // The dentist's level once validated; the model's suggestion until then.
  risk_level: { type: String, enum: ["High", "Medium", "Low"], required: true },
  recommendation: { type: String, default: "" },
  dmf_score: { type: Number, required: true },
  dmf_index: { type: String, enum: ["DMF", "dmf"], required: true },
  validated_by_dentist: { type: Boolean, default: false },
  validated_at: { type: Date, default: null },
  /** What the model suggested, kept after the dentist decides (null when no
   *  suggestion was available and the dentist picked the level alone). */
  model_risk_level: { type: String, enum: ["High", "Medium", "Low", null], default: null },
  /** The model's probability for its suggestion, 0 to 1. */
  model_confidence: { type: Number, min: 0, max: 1, default: null },
  /** Why the dentist agreed or changed the level. ENCRYPTED (clinical free text). */
  dentist_notes: { type: String, default: "" },
  treatment_decisions: { type: [treatmentDecisionSchema], default: [] },
  ...softDeleteFields,
});

riskStratificationSchema.plugin(fieldEncryption, fieldEncryptionOptions(["dentist_notes"]));

export default getModel("RiskStratification", riskStratificationSchema);
