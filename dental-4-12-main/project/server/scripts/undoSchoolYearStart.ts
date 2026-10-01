import "../dnsFix.js";
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Student, StudentIptr, SchoolYearRollover } from "../models/index.js";
import { schoolYearLabel, nextSchoolYear } from "../../shared/schoolYear.js";

/**
 * Undoes "Update School Year" (startSchool in schoolYearController.ts).
 *
 * The start did two things, and this reverses both:
 *  1. Cleared STUDENT.grade_level/section, after copying them to the outgoing
 *     year's STUDENT_IPTR. → copies them back from that IPTR.
 *  2. Marked the school "started" for the next year. → sets the row back to
 *     "planned" (not started). Nothing is deleted.
 *  3. Added an EMPTY next-year IPTR (no grade, no section) to every student so
 *     the dental chart lists the year. → those empty rows are ARCHIVED (soft
 *     delete). A next-year IPTR that has a grade is real work and is left alone.
 *
 * A student is restored only if their grade AND section are empty now, the
 * outgoing-year IPTR has a grade or section, and they have no IPTR for the
 * next year yet (one that exists means they were assigned after the start, so
 * their grade is next year's and must not be overwritten).
 * Outgoing-year IPTRs the start created are left in place; they hold real data.
 *
 * Dry run by default. Pass --confirm to write.
 *   npx tsx server/scripts/undoSchoolYearStart.ts
 *   npx tsx server/scripts/undoSchoolYearStart.ts --confirm
 */
const confirm = process.argv.includes("--confirm");

async function main() {
  await connectDB();
  const current = schoolYearLabel();
  const next = nextSchoolYear(current);
  console.log(`${confirm ? "WRITING" : "DRY RUN"}: undoing the start of ${next} (restoring ${current}).`);

  const started = await SchoolYearRollover.find({ school_year: next, status: "started", school_id: { $ne: null }, isArchived: false })
    .select("school_id")
    .lean<{ _id: unknown; school_id: unknown }[]>();
  console.log(`Schools marked started for ${next}: ${started.length}`);

  let restored = 0;
  for (const row of started) {
    const empties = await Student.find({
      school_id: row.school_id,
      isArchived: false,
      grade_level: { $in: ["", null] },
      section: { $in: ["", null] },
    })
      .select("_id")
      .lean<{ _id: unknown }[]>();
    const ids = empties.map((s) => s._id);
    const inNext = new Set(
      (await StudentIptr.find({ student_id: { $in: ids }, school_year: next, isArchived: false, grade_level: { $nin: [null, ""] } }).select("student_id").lean<{ student_id: unknown }[]>())
        .map((i) => String(i.student_id)),
    );
    const iptrs = await StudentIptr.find({ student_id: { $in: ids }, school_year: current, isArchived: false })
      .select("student_id grade_level section")
      .lean<{ student_id: unknown; grade_level?: string | null; section?: string | null }[]>();
    for (const i of iptrs) {
      if (inNext.has(String(i.student_id)) || (!i.grade_level && !i.section)) continue;
      restored += 1;
      if (confirm) {
        await Student.updateOne({ _id: i.student_id }, { $set: { grade_level: i.grade_level ?? "", section: i.section ?? "" } });
      }
    }
    if (confirm) {
      const schoolStudents = await Student.find({ school_id: row.school_id, isArchived: false }).select("_id").lean<{ _id: unknown }[]>();
      await StudentIptr.updateMany(
        { student_id: { $in: schoolStudents.map((s) => s._id) }, school_year: next, isArchived: false, grade_level: { $in: [null, ""] }, section: { $in: [null, ""] } },
        { $set: { isArchived: true, archivedAt: new Date() } },
      );
      await SchoolYearRollover.updateOne(
        { _id: row._id },
        { $set: { status: "planned", start_kind: null, started_by: null, started_at: null } },
      );
    }
  }
  console.log(`Students ${confirm ? "restored" : "that would be restored"}: ${restored}`);
  if (!confirm) console.log("Nothing written. Re-run with --confirm to apply.");
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
