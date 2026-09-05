import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Student from "../models/Student.js";
import StudentIptr from "../models/StudentIptr.js";

// One-off migration: carry STUDENT.consent_status (removed from the schema,
// but still sitting in existing MongoDB documents) onto STUDENT_IPTR, the
// same move Sprint 57a made for grade_level/section.
//
// Dry-run by default — prints what it would write and saves NOTHING. Pass
// --confirm to write. Run backupRaw.ts first.
//
//   npx tsx server/scripts/migrateIptrConsent.ts            (dry run)
//   npx tsx server/scripts/migrateIptrConsent.ts --confirm  (writes)
//
// ⚠ ONLY THE LATEST IPTR PER STUDENT IS FILLED, and only when it was
// "complete" — the schema default is already "pending", so there's nothing
// honest to backfill for a student who was never marked complete. Consent is
// per school year now: a "complete" recorded under the old lifetime field
// only ever meant "complete as of whenever someone last checked the box",
// which is true of the most recent year, not of every year before it.
// Stamping it onto older IPTRs would assert a guardian signed off in a year
// that field never even existed for — exactly the kind of invented fact
// CLAUDE.md's "nothing cosmetic" rule and Sprint 57a both rule out. Older
// years are left at the "pending" default, same as a brand new year always
// starts.
//
// Latest = highest `school_year` string. School years are "2025-2026" format,
// so lexicographic ordering is chronological ordering.

const CONFIRM = process.argv.includes("--confirm");

async function run() {
  await connectDB();

  // .lean() reads the raw MongoDB document regardless of what the current
  // schema declares, so the old consent_status is still readable even though
  // it is no longer a Student schema path.
  const students = await Student.find({ isArchived: false }).lean();
  const iptrs = await StudentIptr.find({ isArchived: false });

  const byStudent = new Map<string, any[]>();
  for (const i of iptrs as any[]) {
    const key = String(i.student_id);
    const list = byStudent.get(key) ?? [];
    list.push(i);
    byStudent.set(key, list);
  }

  let willWrite = 0;
  let alreadyComplete = 0;
  let noConsentToCarry = 0;
  let noIptr = 0;

  for (const s of students as any[]) {
    if (s.consent_status !== "complete") {
      noConsentToCarry++;
      continue;
    }
    const mine = byStudent.get(String(s._id)) ?? [];
    if (mine.length === 0) {
      noIptr++;
      continue;
    }
    const sorted = [...mine].sort((a, b) => String(a.school_year).localeCompare(String(b.school_year)));
    const latest = sorted[sorted.length - 1];
    if (latest.consent_status === "complete") {
      alreadyComplete++;
      continue;
    }
    willWrite++;
    console.log(
      `  ${String(s.last_name ?? "").trim()}, ${String(s.first_name ?? "").trim()}  ` +
        `${latest.school_year} → complete` +
        (sorted.length > 1 ? `   (${sorted.length - 1} older year(s) left "pending")` : ""),
    );
    if (CONFIRM) {
      latest.consent_status = "complete";
      await latest.save();
    }
  }

  console.log(`\n${students.length} student(s), ${iptrs.length} IPTR(s)`);
  console.log(`  ${willWrite} latest IPTR(s) ${CONFIRM ? "written" : "would be written"}`);
  console.log(`  ${alreadyComplete} latest IPTR(s) already "complete" — untouched`);
  console.log(`  ${noConsentToCarry} student(s) had no "complete" consent to carry over`);
  console.log(`  ${noIptr} student(s) with "complete" consent have no IPTR at all — nothing to write it onto`);
  if (!CONFIRM) console.log(`\nDRY RUN — nothing was written. Re-run with --confirm to apply.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
