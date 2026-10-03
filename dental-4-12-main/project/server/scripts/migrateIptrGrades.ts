import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Student from "../models/Student.js";
import StudentIptr from "../models/StudentIptr.js";

// One-off migration: stamp `grade_level` + `section` onto STUDENT_IPTR
// (Sprint 57a).
//
// Dry-run by default — prints what it would write and saves NOTHING. Pass
// --confirm to write. Run backupRaw.ts first.
//
//   npx tsx server/scripts/migrateIptrGrades.ts            (dry run)
//   npx tsx server/scripts/migrateIptrGrades.ts --confirm  (writes)
//
// ⚠ ONLY THE LATEST IPTR PER STUDENT IS FILLED, and that is the whole design.
// STUDENT holds ONE grade_level/section: the student's grade TODAY. That value
// is only true of their most recent school year. Copying it onto older IPTRs
// would write "this child was in Grade 5 in 2023-2024" into the database as
// fact, which is exactly the bug this sprint exists to remove — it would make
// the lie durable instead of merely displayed. Older years stay null and the
// UI renders them as "Grade not recorded", which is honest: the system never
// captured that information, and it cannot be recovered.
//
// Latest = highest `school_year` string. School years are "2025-2026" format,
// so lexicographic ordering is chronological ordering.

const CONFIRM = process.argv.includes("--confirm");

/** The school year containing today, "YYYY-YYYY". June–April per the clinic
 *  calendar; May is bucketed to the year about to start, matching
 *  utils/schoolYear.ts on the client. */
function currentSchoolYear(d = new Date()): string {
  const y = d.getFullYear();
  return d.getMonth() <= 3 ? `${y - 1}-${y}` : `${y}-${y + 1}`;
}

async function run() {
  await connectDB();

  // Encrypted fields are irrelevant here (grade_level and section are
  // plaintext), but Student is still read as documents rather than lean so the
  // model behaves normally.
  const students = await Student.find({ isArchived: false });
  const iptrs = await StudentIptr.find({ isArchived: false });

  const byStudent = new Map<string, any[]>();
  for (const i of iptrs as any[]) {
    const key = String(i.student_id);
    const list = byStudent.get(key) ?? [];
    list.push(i);
    byStudent.set(key, list);
  }

  let willWrite = 0;
  let alreadySet = 0;
  let leftNull = 0;
  let noIptr = 0;
  let futureOnly = 0;
  const SY_NOW = currentSchoolYear();
  console.log(`Current school year: ${SY_NOW}
`);

  for (const s of students as any[]) {
    const mine = byStudent.get(String(s._id)) ?? [];
    if (mine.length === 0) {
      noIptr++;
      continue;
    }
    const sorted = [...mine].sort((a, b) => String(a.school_year).localeCompare(String(b.school_year)));
    // The target is the latest year that is NOT IN THE FUTURE. STUDENT's grade
    // is today's grade, so it is true of the current school year — not of a
    // year that has not started. An IPTR pre-created for next year would get
    // "the grade they are in now", asserting a promotion that has not happened,
    // which is the same false fact this sprint removes. Those stay null and are
    // filled when that year actually starts.
    const target = [...sorted].reverse().find((i) => String(i.school_year) <= SY_NOW);
    const others = sorted.filter((i) => i !== target);
    leftNull += others.filter((i) => !i.grade_level).length;

    if (!target) {
      futureOnly++;
      continue;
    }
    if (target.grade_level) {
      alreadySet++;
      continue;
    }
    const latest = target;
    const older = others;
    willWrite++;
    console.log(
      `  ${String(s.last_name ?? "").trim()}, ${String(s.first_name ?? "").trim()}  ` +
        `${latest.school_year} → ${s.grade_level} ${s.section}` +
        (older.length ? `   (${older.length} other year(s) left "not recorded")` : ""),
    );
    if (CONFIRM) {
      latest.grade_level = s.grade_level;
      latest.section = s.section;
      await latest.save();
    }
  }

  console.log(`\n${students.length} student(s), ${iptrs.length} IPTR(s)`);
  console.log(`  ${willWrite} latest IPTR(s) ${CONFIRM ? "written" : "would be written"}`);
  console.log(`  ${alreadySet} already carried a grade — untouched`);
  console.log(`  ${leftNull} other IPTR(s) deliberately left "not recorded" (older years, and any pre-created future year)`);
  console.log(`  ${futureOnly} student(s) have ONLY future-dated IPTRs — skipped entirely`);
  console.log(`  ${noIptr} student(s) have no IPTR at all`);
  if (!CONFIRM) console.log(`\nDRY RUN — nothing was written. Re-run with --confirm to apply.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
