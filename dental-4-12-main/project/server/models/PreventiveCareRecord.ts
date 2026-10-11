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

    // ── The services performed AT this visit (Sprint 147) ─────────────────
    //
    // ERD deviation, like REFERRAL and DAY_NOTE. Until now this model recorded
    // that a pupil was SEEN and never what was DONE — four fields, none of them
    // a service — while CLAUDE.md's module 5 defines an RPC visit as exactly
    // these services and page 2 of the Target Client List prints them as
    // per-visit tick columns for the 1st and 2nd visit.
    //
    // ⚠ THIS IS WHAT MADE THREE FILED FIGURES APPROXIMATIONS. With no service
    // on the visit, the TCL had to answer "has this pupil EVER had fluoride
    // varnish?" from the dental chart where the form asks "was it done at THIS
    // visit?", and the DOH report inferred 1st/2nd application from chart dates
    // because nothing recorded the ordinal. Both said so in their own comments.
    //
    // ⚠ DEFAULT null, NOT false — the same rule `facility_based` above follows,
    // and for the same reason. Every visit recorded before this change has no
    // answer, and `false` would claim on a form filed with the City Health
    // Office that a service was withheld. Null reads as "not recorded".
    oral_screening: { type: Boolean, default: null },
    oral_prophylaxis: { type: Boolean, default: null },
    fluoride_varnish: { type: Boolean, default: null },
    oral_hygiene_instruction: { type: Boolean, default: null },
    // The form prints Low / Moderate / High. ⚠ "Moderate" is the FORM's word;
    // RISK_STRATIFICATION calls the same band "Medium". The form wins on the
    // form, so the value stored here is the form's.
    caries_risk: { type: String, enum: ["Low", "Moderate", "High", null], default: null },

    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

// Sprint 91. `filterable: ["iptr_id"]` — the RPC visit lookup.
preventiveCareRecordSchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("PreventiveCareRecord", preventiveCareRecordSchema);
