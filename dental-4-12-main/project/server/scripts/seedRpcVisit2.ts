import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { Student, StudentIptr, PreventiveCareRecord } from "../models/index.js";
import mongoose from "mongoose";

// Backdates a couple of already-seeded students' Visit 1 dates and adds Visit 2
// records so RPC tracking has realistic status variety (complete/overdue/pending/
// not-started) instead of everyone looking "pending" with a recent Visit 1.
const ADJUSTMENTS = [
  { full_name: "Aldrin Villanueva", visit1DaysAgo: 200, addVisit2: true, visit2DaysAgo: 140 },
  { full_name: "Trisha Santos", visit1DaysAgo: 200, addVisit2: false },
];

async function main() {
  await connectDB();
  announceTarget("seedRpcVisit2");

  // full_name is encrypted (Sprint 8), so it can't be queried directly by
  // plaintext value — fetch all students and match after Mongoose decrypts
  // them on read.
  const allStudents = await Student.find({});

  for (const adj of ADJUSTMENTS) {
    const student = allStudents.find((s) => s.full_name === adj.full_name);
    if (!student) {
      console.log(`Student ${adj.full_name} not found — run npm run seed:students first`);
      continue;
    }
    const iptr = await StudentIptr.findOne({ student_id: student._id });
    if (!iptr) continue;

    const visit1 = await PreventiveCareRecord.findOne({ iptr_id: iptr._id, visit_number: 1 });
    if (!visit1) continue;

    const visit1Date = new Date();
    visit1Date.setDate(visit1Date.getDate() - adj.visit1DaysAgo);
    visit1.visit_date = visit1Date;
    await visit1.save();
    console.log(`Backdated ${adj.full_name}'s Visit 1 to ${adj.visit1DaysAgo} days ago`);

    if (adj.addVisit2) {
      const existingVisit2 = await PreventiveCareRecord.findOne({ iptr_id: iptr._id, visit_number: 2 });
      if (!existingVisit2) {
        const visit2Date = new Date();
        visit2Date.setDate(visit2Date.getDate() - (adj.visit2DaysAgo ?? 0));
        await PreventiveCareRecord.create({ iptr_id: iptr._id, visit_date: visit2Date, visit_number: 2 });
        console.log(`Added Visit 2 for ${adj.full_name}`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
