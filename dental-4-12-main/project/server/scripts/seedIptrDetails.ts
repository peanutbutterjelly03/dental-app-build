import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import { connectDB } from "../config/db.js";
import { StudentIptr, MedicalHistory, DietarySocialHabits, OralHealthCondition, RiskStratification, PreventiveCareRecord } from "../models/index.js";
import mongoose from "mongoose";

// Deterministic pseudo-variety based on a string, so reruns are idempotent-ish
// without needing per-student hardcoded data.
function hashIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

async function main() {
  await connectDB();

  const iptrs = await StudentIptr.find({});
  let medicalCreated = 0;
  let dietaryCreated = 0;
  let oralCreated = 0;

  for (const iptr of iptrs) {
    const id = iptr._id.toString();

    if (!(await MedicalHistory.findOne({ iptr_id: iptr._id }))) {
      const hasAllergy = hashIndex(id, 6) === 0;
      const hasHypertension = hashIndex(id + "h", 8) === 0;
      await MedicalHistory.create({
        iptr_id: iptr._id,
        allergies: hasAllergy ? "Seafood" : "",
        diabetes_mellitus: false,
        hypertension: hasHypertension,
        cardiovascular_disease: false,
        thyroid_disorders: false,
        hepatitis_disorders: false,
        malignancy: false,
        previous_hospitalization: hashIndex(id + "ph", 5) === 0,
        previous_surgical: false,
        blood_transfusion: false,
        tattoo: false,
        others: "",
      });
      medicalCreated++;
    }

    if (!(await DietarySocialHabits.findOne({ iptr_id: iptr._id }))) {
      await DietarySocialHabits.create({
        iptr_id: iptr._id,
        sugar_beverages: hashIndex(id + "s", 3) !== 0,
        alcohol_drinker: false,
        tobacco_user: false,
        betel_nut_chewer: false,
        body_piercing: false,
        nail_biting: hashIndex(id + "n", 4) === 0,
        thumb_sucking: hashIndex(id + "t", 5) === 0,
      });
      dietaryCreated++;
    }

    if (!(await OralHealthCondition.findOne({ iptr_id: iptr._id }))) {
      const preventive = await PreventiveCareRecord.findOne({ iptr_id: iptr._id, visit_number: 1 });
      const risk = preventive ? await RiskStratification.findOne({ preventive_id: preventive._id }) : null;
      const riskLevel = risk?.risk_level ?? null;

      const oralHygiene = riskLevel === "High" ? "Poor" : riskLevel === "Medium" ? "Fair" : "Good";
      await OralHealthCondition.create({
        iptr_id: iptr._id,
        oral_hygiene: oralHygiene,
        gingivitis: riskLevel === "High",
        periodontal_disease: false,
        debris: riskLevel === "High" || riskLevel === "Medium",
        calculus: riskLevel === "High",
        abnormal_growth: false,
        cleft_lip_palate: false,
        others: "",
      });
      oralCreated++;
    }
  }

  console.log(`Created: ${medicalCreated} MedicalHistory, ${dietaryCreated} DietarySocialHabits, ${oralCreated} OralHealthCondition records.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
