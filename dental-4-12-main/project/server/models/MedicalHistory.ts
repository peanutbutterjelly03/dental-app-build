import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";
import { softDeleteFields } from "./shared/softDelete.js";

const medicalHistorySchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    allergies: { type: String, default: "" },
    // ⚠ Every yes/no below is TRI-STATE since 2026-09-24: true = "Oo",
    // false = "Hindi" (asked, answered no), null = NOT ASKED. The default was
    // `false`, which made DOH Form 1 print a Hindi tick for questions nobody
    // asked -- a clinical claim on a signed form. Records saved before this
    // keep their stored `false` (it cannot be told apart from a real "no"
    // after the fact); everything new starts null.
    diabetes_mellitus: { type: Boolean, default: null },
    hypertension: { type: Boolean, default: null },
    cardiovascular_disease: { type: Boolean, default: null },
    thyroid_disorders: { type: Boolean, default: null },
    hepatitis_disorders: { type: Boolean, default: null },
    malignancy: { type: Boolean, default: null },
    previous_hospitalization: { type: Boolean, default: null },
    previous_surgical: { type: Boolean, default: null },
    blood_transfusion: { type: Boolean, default: null },
    tattoo: { type: Boolean, default: null },
    others: { type: String, default: "" },
    // ── ERD DEVIATION (2026-09-24, user-approved) ──────────────────────────
    // The IPTR's "Blood Disorders" row, which had nowhere to be stored.
    blood_disorders: { type: Boolean, default: null },
    // DOH Form 1's Filipino history questions that no field above answers.
    // Kept SEPARATE from the nearest IPTR field on purpose: "sakit sa atay"
    // is broader than hepatitis and "kulang sa dugo" is one kind of blood
    // disorder, so answering one from the other would print a claim nobody made.
    liver_disease: { type: Boolean, default: null },        // Q3  sakit sa atay
    anemia: { type: Boolean, default: null },               // Q4  kulang sa dugo
    anesthesia_allergy: { type: Boolean, default: null },   // Q7  allergy sa pamamanhid
    previous_extraction: { type: Boolean, default: null },  // Q8  nabunutan na ng ngipin
    extraction_bleeding: { type: Boolean, default: null },  // Q9  madugo kapag binubunutan
    chest_tightness: { type: Boolean, default: null },      // Q10 naninikip ang dibdib / madaling mapagod
    asthma: { type: Boolean, default: null },               // Q11 hika
    menstruation: { type: Boolean, default: null },         // Q12 regla (female only)
    pregnant: { type: Boolean, default: null },             // Q13 buntis (female only)
    current_medication: { type: Boolean, default: null },   // Q15 may iniinom na gamot
    epilepsy: { type: Boolean, default: null },             // Q16 epilepsy
    // The forms' "Please specify" / "Ano?" details. Encrypted, like allergies.
    hepatitis_type: { type: String, default: "" },
    malignancy_details: { type: String, default: "" },
    blood_transfusion_date: { type: String, default: "" },  // "Month & Year", as the IPTR prints it
    last_admission: { type: String, default: "" },          // IPTR "Medical (Last Admission & Cause)"
    medication_details: { type: String, default: "" },     // Form 1 Q15 "Ano?"
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

medicalHistorySchema.plugin(fieldEncryption, fieldEncryptionOptions([
  "allergies", "others",
  "hepatitis_type", "malignancy_details", "blood_transfusion_date", "last_admission", "medication_details",
]));

// Sprint 91. `filterable: ["iptr_id"]` — one IPTR's history, not the collection.
medicalHistorySchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("MedicalHistory", medicalHistorySchema);
