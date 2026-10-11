import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { splitFullName } from "./splitStudentNames.js";
import { School, Student, StudentIptr, DentalChart, Dentist, PreventiveCareRecord, RiskStratification } from "../models/index.js";
import mongoose from "mongoose";

import { DEMO_STUDENTS as STUDENTS } from "./demoStudents.js";

async function main() {
  await connectDB();
  announceTarget("seedStudents");

  const schools: Record<string, any> = {};
  for (const s of await School.find({})) schools[s.school_name] = s;

  const dentist = await Dentist.findOne({}).sort({ created_at: 1 });
  if (!dentist) {
    throw new Error("No Dentist record found — run `npm run seed:demo` first");
  }

  // full_name is encrypted with a RANDOM IV (Sprint 26), so a plaintext
  // equality query can never match the stored ciphertext. Fetch once and
  // dedup in JS after mongoose decrypts on read — same pattern as
  // seedRpcVisit2.ts (Sprint 12 lesson).
  const existingBySchool = new Map<string, Set<string>>();
  for (const st of await Student.find({})) {
    const key = String(st.school_id);
    const set = existingBySchool.get(key) ?? new Set<string>();
    set.add(st.full_name);
    existingBySchool.set(key, set);
  }

  let created = 0;
  for (const s of STUDENTS) {
    const school = schools[s.school];
    if (!school) {
      console.log(`Skipping ${s.full_name}: school "${s.school}" not found — run npm run seed:demo first`);
      continue;
    }

    if (existingBySchool.get(String(school._id))?.has(s.full_name)) {
      console.log(`Student ${s.full_name} already exists, skipping.`);
      continue;
    }

    // Name parts are required now; reuse the migration's splitter rather than
    // duplicating the suffix/particle rules here.
    const parts = splitFullName(s.full_name);
    const student = await Student.create({
      school_id: school._id,
      last_name: parts.last_name,
      first_name: parts.first_name,
      middle_name: parts.middle_name,
      birthday: new Date(s.birthday),
      sex: s.sex,
      // HOME address, not the school. This previously seeded the school name,
      // which made every demo record show its school in the Address field.
      address: "Barangay Tanyag, Taguig City",
      grade_level: s.grade_level,
      section: s.section,
      // Marks this as seeded, not encoded by a person. purgeDemoData.ts deletes
      // on this flag alone — see Student.ts.
      is_demo: true,
    });

    const iptr = await StudentIptr.create({ student_id: student._id, school_year: "2025-2026" });

    if (s.risk) {
      const chartDate = new Date();
      chartDate.setDate(chartDate.getDate() - Math.floor(Math.random() * 60));
      await DentalChart.create({ iptr_id: iptr._id, dentist_id: dentist._id, date_charted: chartDate });

      const preventive = await PreventiveCareRecord.create({
        iptr_id: iptr._id,
        visit_date: chartDate,
        visit_number: 1,
      });

      await RiskStratification.create({
        preventive_id: preventive._id,
        risk_level: s.risk,
        dmf_score: s.risk === "High" ? 5 : s.risk === "Medium" ? 2 : 0,
        // Secondary rows carry "DMF" (permanent dentition); elementary rows
        // default to "dmf" as before. The DOH table counts the two on
        // separate lines, so getting this wrong puts high school pupils on
        // the primary-teeth row.
        dmf_index: (s as { dmf_index?: string }).dmf_index ?? "dmf",
      });
    }

    created++;
    console.log(`Created student: ${s.full_name} (${s.school}, risk: ${s.risk ?? "not screened"})`);
  }

  console.log(`Done. ${created} new students created.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
