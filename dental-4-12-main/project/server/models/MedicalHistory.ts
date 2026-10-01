import mongoose from "mongoose";
import { getModel } from "./shared/getModel.js";
import { fieldEncryption } from "mongoose-field-encryption";
import { fieldEncryptionOptions } from "./shared/fieldEncryption.js";
import { softDeleteFields } from "./shared/softDelete.js";

const medicalHistorySchema = new mongoose.Schema(
  {
    iptr_id: { type: mongoose.Schema.Types.ObjectId, ref: "StudentIptr", required: true },
    allergies: { type: String, default: "" },
    // Yes/no answers are plain booleans: a ticked chip is "Oo", an unticked
    // one "Hindi" on DOH Form 1 (user decision, 2026-09-24).
    diabetes_mellitus: { type: Boolean, default: false },
    hypertension: { type: Boolean, default: false },
    cardiovascular_disease: { type: Boolean, default: false },
    thyroid_disorders: { type: Boolean, default: false },
    hepatitis_disorders: { type: Boolean, default: false },
    malignancy: { type: Boolean, default: false },
    previous_hospitalization: { type: Boolean, default: false },
    previous_surgical: { type: Boolean, default: false },
    blood_transfusion: { type: Boolean, default: false },
    tattoo: { type: Boolean, default: false },
    others: { type: String, default: "" },
    // ── ERD DEVIATION (2026-09-24, user-approved) ──────────────────────────
    // The IPTR's "Blood Disorders" row, which had nowhere to be stored.
    blood_disorders: { type: Boolean, default: false },
    // DOH Form 1's Filipino history questions that no field above answers.
    // Kept SEPARATE from the nearest IPTR field on purpose: "sakit sa atay"
    // is broader than hepatitis and "kulang sa dugo" is one kind of blood
    // disorder, so answering one from the other would print a claim nobody made.
    liver_disease: { type: Boolean, default: false },        // Q3  sakit sa atay
    anemia: { type: Boolean, default: false },               // Q4  kulang sa dugo
    anesthesia_allergy: { type: Boolean, default: false },   // Q7  allergy sa pamamanhid
    previous_extraction: { type: Boolean, default: false },  // Q8  nabunutan na ng ngipin
    extraction_bleeding: { type: Boolean, default: false },  // Q9  madugo kapag binubunutan
    chest_tightness: { type: Boolean, default: false },      // Q10 naninikip ang dibdib / madaling mapagod
    asthma: { type: Boolean, default: false },               // Q11 hika
    menstruation: { type: Boolean, default: false },         // Q12 regla (female only)
    pregnant: { type: Boolean, default: false },             // Q13 buntis (female only)
    current_medication: { type: Boolean, default: false },   // Q15 may iniinom na gamot
    epilepsy: { type: Boolean, default: false },             // Q16 epilepsy
    // Q5 "Mataas ba ang presyon?" as its own chip (user, 2026-09-24). Form 1
    // prints Oo when this OR `hypertension` is ticked: hypertension IS high
    // blood pressure, so a Hindi beside a ticked Hypertension would contradict it.
    high_blood_pressure: { type: Boolean, default: false },
    // The forms' "Please specify" / "Ano?" details. Encrypted, like allergies.
    hepatitis_type: { type: String, default: "" },
    malignancy_details: { type: String, default: "" },
    blood_transfusion_date: { type: String, default: "" },  // "Month & Year", as the IPTR prints it
    last_admission: { type: String, default: "" },          // IPTR "Medical (Last Admission & Cause)"
    medication_details: { type: String, default: "" },     // Form 1 Q15 "Ano?"
    last_extraction_date: { type: String, default: "" },   // Form 1 Q8, optional "if remembered"
    surgical_details: { type: String, default: "" },       // IPTR "Surgical (Post-Operative)"
    ...softDeleteFields,
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

medicalHistorySchema.plugin(fieldEncryption, fieldEncryptionOptions([
  "allergies", "others",
  "hepatitis_type", "malignancy_details", "blood_transfusion_date", "last_admission", "medication_details",
  "last_extraction_date", "surgical_details",
]));

// Sprint 91. `filterable: ["iptr_id"]` — one IPTR's history, not the collection.
medicalHistorySchema.index({ isArchived: 1, iptr_id: 1 });

export default getModel("MedicalHistory", medicalHistorySchema);
