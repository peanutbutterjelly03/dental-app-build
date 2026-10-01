// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { announceTarget, requireConfirmOnProduction } from "./announceTarget.js";
import { StudentIptr, Student } from "../models/index.js";
import mongoose from "mongoose";

/**
 * Sprint 130 — stamps `grade_level` / `section` onto STUDENT_IPTR rows that
 * have none, copying them from the pupil's current STUDENT record.
 *
 * WHY: the DOH Consolidated report is grade x age x sex. Measured 2026-09-05,
 * 0 of 26 IPTRs carried a grade while all 26 students did, so every record fell
 * into "no grade column" and the whole grid printed blank — a fully charted
 * database that reads as a broken form. The page already said so in its own
 * caption ("26 records predate grade being stored per school year"); this is
 * that backlog of records, not a display bug.
 *
 * ⚠ WHAT THIS ASSUMES, stated because it is the one thing that can be wrong:
 * the pupil's CURRENT grade is used for the year the IPTR belongs to. That is
 * correct for a record created before Sprint 57a introduced per-year grades and
 * never promoted since, which is what the seeded data is. It is NOT correct for
 * a pupil who has since moved up: their older years would be stamped with
 * today's grade. So it only fills EMPTY fields, never overwrites, and it
 * reports how many years each pupil has — more than one is the case a human
 * should look at.
 *
 * Dry run by default; pass --confirm to write. Refuses on production without
 * an explicit --confirm, like every other writing script.
 */
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  await connectDB();
  announceTarget("backfillIptrGrades");
  requireConfirmOnProduction("backfillIptrGrades", CONFIRM);

  const iptrs = await StudentIptr.find({ isArchived: false });
  if (iptrs.length === 0) throw new Error("PRECONDITION FAILED: no StudentIptr rows found — nothing to compare against");

  const students = await Student.find({ isArchived: false });
  const byId = new Map(students.map((s: any) => [String(s._id), s]));

  const empty = iptrs.filter((i: any) => !i.grade_level);
  const yearsPerStudent = new Map<string, number>();
  for (const i of iptrs as any[]) {
    const k = String(i.student_id);
    yearsPerStudent.set(k, (yearsPerStudent.get(k) ?? 0) + 1);
  }

  console.log(
    `IPTRs: ${iptrs.length} · already have a grade: ${iptrs.length - empty.length} · empty: ${empty.length}`
  );

  let filled = 0;
  let noStudent = 0;
  let noSourceGrade = 0;
  let multiYear = 0;

  for (const iptr of empty as any[]) {
    const student = byId.get(String(iptr.student_id));
    if (!student) { noStudent++; continue; }
    if (!student.grade_level) { noSourceGrade++; continue; }
    if ((yearsPerStudent.get(String(iptr.student_id)) ?? 0) > 1) {
      multiYear++;
      console.log(
        `  ⚠ ${String(iptr._id)} — pupil has ${yearsPerStudent.get(String(iptr.student_id))} school years; ` +
          `stamping today's grade on year ${iptr.school_year} may be wrong. Skipped.`
      );
      continue;
    }
    if (CONFIRM) {
      iptr.grade_level = student.grade_level;
      if (!iptr.section && student.section) iptr.section = student.section;
      await iptr.save();
    }
    filled++;
  }

  console.log(
    `\n${CONFIRM ? "Filled" : "Would fill"}: ${filled}` +
      `\nSkipped — pupil missing: ${noStudent} · pupil has no grade either: ${noSourceGrade} · pupil has several years: ${multiYear}`
  );
  if (!CONFIRM) console.log("\nDry run. Pass --confirm to write.");

  if (CONFIRM) {
    const left = (await StudentIptr.find({ isArchived: false })).filter((i: any) => !i.grade_level).length;
    console.log(`Verify: ${left} IPTR(s) still without a grade.`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
