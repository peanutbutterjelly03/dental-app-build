// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { announceTarget, requireConfirmOnProduction } from "./announceTarget.js";
import { Appointment, Student, Dentist } from "../models/index.js";
import mongoose from "mongoose";

/**
 * Sprint 132 — demo appointments. There was NO appointment seeder at all:
 * measured 2026-09-05, the dev database held 0 appointments against 26
 * students, so the Appointments screen demoed completely empty — every tab
 * ("Today 0 / Upcoming 0 / Completed 0 / Missed 0"), the calendar, and the
 * day dialog's schedule half, which Sprint 131 had therefore never been able
 * to verify with real data.
 *
 * ⚠ ONLY `is_demo` STUDENTS ARE USED. That is what makes these rows removable:
 * `purge:demo` deletes appointments by `student_id` against the demo students,
 * so seeded appointments come out with them. A pupil encoded by a person is
 * never given a fabricated appointment.
 *
 * The spread is deliberate rather than random — one bucket per tab, so every
 * tab has something to show and the day dialog has a day with several pupils
 * in one session:
 *   · TODAY        two sessions, Scheduled  → the Today tab, and mark-attended
 *   · UPCOMING     +3 and +10 days, Scheduled
 *   · COMPLETED    -7 days, Completed
 *   · MISSED       -14 days, Missed
 *
 * Sessions are grouped by (datetime, grade, section) in the UI, so pupils that
 * share a slot must share a datetime exactly — hence the fixed hours below.
 *
 * Idempotent by refusal, like `seed:demo`: if any appointment already exists it
 * stops rather than doubling the data. Dry run by default; --confirm writes.
 */
const CONFIRM = process.argv.includes("--confirm");

const TYPES = ["Regular Checkup", "Screening", "Fluoride Application", "Follow-up"] as const;

/** Local midnight `days` from today, then the given hour — never UTC, so a
 *  seeded "today" is today in the clinic's timezone and not yesterday. */
function at(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  await connectDB();
  announceTarget("seedAppointments");
  requireConfirmOnProduction("seedAppointments", CONFIRM);

  const existing = await Appointment.countDocuments({});
  if (existing > 0) {
    console.log(`${existing} appointment(s) already exist — refusing to seed on top of them.`);
    console.log("Archive or remove them first if you want a clean demo set.");
    await mongoose.disconnect();
    return;
  }

  const dentist = await Dentist.findOne({ isArchived: false });
  if (!dentist) throw new Error("PRECONDITION FAILED: no DENTIST row — run `npm run seed:demo` first");

  // `is_demo` is the flag purge:demo matches on (Sprint 117). Fetching all and
  // filtering in JS because the name fields are encrypted with a random IV, so
  // a plaintext query can never match (Sprint 26) — the same lesson as
  // seedStudents.ts.
  const all = await Student.find({ isArchived: false });
  const demo = all.filter((s: any) => s.is_demo === true);
  if (demo.length < 6) {
    throw new Error(
      `PRECONDITION FAILED: only ${demo.length} demo student(s) found (need 6). ` +
        `Run \`npm run seed:students\` first, or check that is_demo is set.`,
    );
  }

  const plan: { when: Date; status: string; students: any[]; note?: string }[] = [
    { when: at(0, 9), status: "Scheduled", students: demo.slice(0, 3) },
    { when: at(0, 13), status: "Scheduled", students: demo.slice(3, 5), note: "Bring guardian" },
    { when: at(3, 9), status: "Scheduled", students: demo.slice(5, 8) },
    { when: at(10, 10), status: "Scheduled", students: demo.slice(8, 10) },
    { when: at(-7, 9), status: "Completed", students: demo.slice(10, 13) },
    { when: at(-14, 10), status: "Missed", students: demo.slice(13, 15), note: "Absent, reschedule" },
  ];

  let created = 0;
  for (const [i, slot] of plan.entries()) {
    for (const student of slot.students) {
      if (CONFIRM) {
        await Appointment.create({
          student_id: student._id,
          dentist_id: dentist._id,
          appointment_datetime: slot.when,
          status: slot.status,
          appointment_type: TYPES[i % TYPES.length],
          requires_followup: slot.status === "Missed",
          notes: slot.note ?? "",
        });
      }
      created++;
    }
    // ⚠ LOCAL time, not `toISOString()`. The clinic is UTC+8, so an ISO string
    // prints a 9am slot as 01:00 and the log contradicts what the app shows.
    console.log(
      `  ${slot.when.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · ${slot.status} · ` +
        `${slot.students.length} pupil(s) · ${TYPES[i % TYPES.length]}`,
    );
  }

  console.log(`\n${CONFIRM ? "Created" : "Would create"}: ${created} appointment(s) across ${plan.length} session(s).`);
  if (!CONFIRM) console.log("\nDry run. Pass --confirm to write.");
  else console.log(`Verify: ${await Appointment.countDocuments({ isArchived: false })} active appointment(s) in the database.`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
