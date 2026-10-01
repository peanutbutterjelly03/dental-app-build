// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import {
  School, User, Dentist, DentalAide, Student, StudentIptr, MedicalHistory,
  DietarySocialHabits, OralHealthCondition, DentalChart, ToothRecord, Treatment,
  PreventiveCareRecord, RiskStratification, Appointment, DentistRotation, AuditTrail,
  DayNote, Referral,
} from "../models/index.js";
import mongoose from "mongoose";

/**
 * Purges the seeded DEMO dataset so it can be reseeded clean, or replaced by
 * real hand-encoded records.
 *
 * HARD DELETE, deliberately. The app must never hard delete (CLAUDE.md); this is
 * maintenance tooling run from a developer machine and never ships to a clinic
 * user. Soft-deleting instead would leave every demo record visible to the
 * System Admin's restore screen forever.
 *
 * SAFETY, in order of importance:
 *  - The system-admin account (SEED_ADMIN_EMAIL) is NEVER deleted. Removing it
 *    would lock the operator out of the deployed app.
 *  - Students are matched on STUDENT.is_demo, which only a seeder ever sets.
 *    A record encoded by a person — Add Student, CSV import, OCR — defaults to
 *    false and is therefore untouchable by this script, whatever it is named,
 *    even if this is run by accident against real data. (Before Sprint 117 the
 *    match was a hardcoded name list; that list had already drifted once, and a
 *    real record sharing a seeded name would have been deleted.)
 *  - Everything else is deleted by FOREIGN KEY from those students / demo users,
 *    never by a blanket query.
 *  - Dry run by default. Pass --confirm to delete.
 *
 * full_name is encrypted with a random IV, so a plaintext equality query can
 * never match; students are fetched and filtered in JS after mongoose decrypts
 * on read (same lesson as seedStudents.ts / seedRpcVisit2.ts).
 */
/**
 * Sprint 129 — the guard that would have caught Sprint 127.
 *
 * `Referral` was added on 2026-09-04 and NOT added to the plan below, so a
 * purge before deployment would have deleted the demo students and their IPTRs
 * and left every referral behind: orphaned rows pointing at `iptr_id`s that no
 * longer exist, invisible in every report (the join drops them) and permanent,
 * since nothing here is hard-deleted afterwards. A comment saying "remember to
 * add new models" is the weak version of this; the script refusing to run is
 * the strong one.
 *
 * Every registered Mongoose model must be either IN the plan or on the
 * exclusion list below WITH A STATED REASON. A new model is therefore a
 * decision — "purge it" or "leave it, because…" — instead of an omission.
 *
 * ⚠ It compares against `mongoose.models`, which only holds what this file
 * IMPORTS. That is why every model is imported above even though several are
 * not deleted: an unimported model is invisible here, and this check would
 * then pass having compared nothing — the exact failure mode of 2026-09-04.
 * `models/index.ts` is the full list; keep the import in step with it.
 */
const NOT_PURGED: Record<string, string> = {
  School: "the three real schools are reference data, not demo data (Sprint 116 nearly deleted them)",
  User: "demo staff accounts are handled separately below; the admin account must survive",
  Dentist: "handled below, by demo user id",
  DentalAide: "handled below, by demo user id",
  DentistRotation: "handled below, by demo dentist id",
  AuditTrail: "cleared separately below, by affected record id",
  DayNote: "written against a DATE and often barangay-wide; not owned by any student, so no demo row can be identified by foreign key",
};

function assertPlanCoversEveryModel(planned: string[]) {
  const registered = Object.keys(mongoose.models);
  if (registered.length === 0) {
    throw new Error("Coverage check compared NOTHING: no models are registered. Are the imports above intact?");
  }
  const missing = registered.filter((name) => !planned.includes(name) && !(name in NOT_PURGED));
  console.log(
    `Coverage: ${registered.length} models registered, ${planned.length} in the purge plan, ` +
      `${Object.keys(NOT_PURGED).length} deliberately excluded.`
  );
  if (missing.length > 0) {
    console.error(
      `\nREFUSING TO RUN. ${missing.length} model(s) are neither purged nor explicitly excluded:\n` +
        missing.map((m) => `  - ${m}`).join("\n") +
        `\n\nAdd each to the plan in purgeDemoData.ts, or to NOT_PURGED with the reason it stays.\n` +
        `A purge that silently skips a collection leaves orphaned rows pointing at deleted parents.`
    );
    process.exit(1);
  }
}

const CONFIRM = process.argv.includes("--confirm");

// Derived from the seeder's own roster -- NEVER hand-maintain this list. A
// hand-copied version drifted once already: it missed the eight Grade 7-10
// pupils Sprint 45 added, so this script would have deleted all three schools
// and the demo staff while leaving those eight behind, pointing at schools
// that no longer existed. See demoStudents.ts.
import { DEMO_STUDENT_NAMES } from "./demoStudents.js";

const DEMO_USER_EMAILS = [
  "dentist@floral.com", "aide@floral.com", "schooladmin@floral.com", "bho@floral.com",
];

// ⚠ These are NOT deleted. They are the three REAL schools this system serves
// (CLAUDE.md, APP CONTEXT) — seeded for convenience, but reference data, not
// demo data. The first hand-encoded student already points at Bagong Tanyag
// Integrated School (found by the Sprint 116 dry run), and deleting + manually
// recreating a school produces an identical row with a NEW _id, orphaning every
// record that referenced the old one. The list is kept because the staff-account
// scoping below still needs to know which schools are the demo ones.
const DEMO_SCHOOLS = [
  "Bagong Tanyag Integrated School",
  "Bagong Tanyag Elementary School Annex A",
  "South Daang Hari Elementary School Main",
];

// Leftovers from earlier test runs. No seeder creates these, but a purge that
// leaves them behind is not clean — after a purge they would be the ONLY rows
// in the schools dropdown. Matched by pattern because the names carry
// timestamps (e.g. "ZZ Test School 1788345859589").
const TEST_STUDENT_NAME_RE = /^(ZZTest|Test NoDate|Intake ZZTest)/i;
const TEST_SCHOOL_NAME_RE = /^ZZ /i;
// Only ARCHIVED @floral.local accounts, from a superseded seeding convention.
// ⚠ admin@floral.local is still ACTIVE and is deliberately NOT matched here —
// deleting a live system_admin could lock the operator out, the same reasoning
// that protects SEED_ADMIN_EMAIL. The user's own account is not @floral.local
// and is never in scope.
const TEST_USER_EMAIL_RE = /@floral\.local$/i;

async function main() {
  await connectDB();
  announceTarget("purgeDemoData");
  console.log(`db: ${mongoose.connection.name}`);
  console.log(CONFIRM ? "MODE: DELETING\n" : "MODE: dry run (pass --confirm to delete)\n");

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (!adminEmail) {
    console.error("SEED_ADMIN_EMAIL is not set — refusing to run without knowing which account to protect.");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Protected admin account: ${adminEmail}\n`);

  // --- students, by exact seeded name -------------------------------------
  // is_demo is AUTHORITATIVE (Sprint 117). Only records a seeder created carry
  // it; anything a person encoded — Add Student, CSV import, OCR — defaults to
  // false and is therefore unreachable by this script no matter what it is
  // named. The name list survives only as a SAFETY CHECK: if it disagrees with
  // the flag, the migration was not run and the script refuses rather than
  // guessing, because guessing wrong here deletes a patient record.
  const allStudents = await (Student as any).find({});
  const demoStudents = allStudents.filter((s: any) => s.is_demo === true);
  const foreign = allStudents.length - demoStudents.length;

  const nameSaysDemo = allStudents.filter(
    (s: any) => DEMO_STUDENT_NAMES.has(s.full_name) || TEST_STUDENT_NAME_RE.test(String(s.full_name ?? ""))
  );
  const unflagged = nameSaysDemo.filter((s: any) => s.is_demo !== true);
  if (unflagged.length > 0) {
    console.error(
      `${unflagged.length} student(s) look like demo data by name but do NOT have is_demo=true.\n` +
        `Run \`npm run backfill:is-demo -- --confirm\` first. Refusing to run: deleting by name\n` +
        `instead would risk a hand-encoded record that happens to share a seeded name.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  const studentIds = demoStudents.map((s: any) => s._id);

  const iptrs = await (StudentIptr as any).find({ student_id: { $in: studentIds } }).lean();
  const iptrIds = iptrs.map((i: any) => i._id);
  const charts = await (DentalChart as any).find({ iptr_id: { $in: iptrIds } }).lean();
  const chartIds = charts.map((c: any) => c._id);
  const preventives = await (PreventiveCareRecord as any).find({ iptr_id: { $in: iptrIds } }).lean();
  const preventiveIds = preventives.map((p: any) => p._id);

  const plan: [string, any, Record<string, unknown>][] = [
    ["ToothRecord",         ToothRecord,         { chart_id: { $in: chartIds } }],
    ["DentalChart",         DentalChart,         { iptr_id: { $in: iptrIds } }],
    ["RiskStratification",  RiskStratification,  { preventive_id: { $in: preventiveIds } }],
    ["PreventiveCareRecord", PreventiveCareRecord, { iptr_id: { $in: iptrIds } }],
    ["MedicalHistory",      MedicalHistory,      { iptr_id: { $in: iptrIds } }],
    ["DietarySocialHabits", DietarySocialHabits, { iptr_id: { $in: iptrIds } }],
    ["OralHealthCondition", OralHealthCondition, { iptr_id: { $in: iptrIds } }],
    ["Treatment",           Treatment,           { iptr_id: { $in: iptrIds } }],
    ["Referral",            Referral,            { iptr_id: { $in: iptrIds } }],
    ["Appointment",         Appointment,         { student_id: { $in: studentIds } }],
    ["StudentIptr",         StudentIptr,         { _id: { $in: iptrIds } }],
    ["Student",             Student,             { _id: { $in: studentIds } }],
  ];

  assertPlanCoversEveryModel(plan.map(([name]) => name));

  console.log(
    `Students: ${demoStudents.length} flagged is_demo=true to delete, ` +
      `${foreign} NOT matched (left alone)\n`
  );

  // Collect the ids BEFORE anything is deleted, so the audit clear below can be
  // scoped by foreign key instead of wiping the collection. Must happen here:
  // once the plan loop runs, these records are gone and cannot be looked up.
  const auditTargetIds: any[] = [];
  for (const [, model, filter] of plan) {
    const docs = await model.find(filter).select("_id").lean();
    for (const d of docs) auditTargetIds.push(d._id);
  }

  for (const [name, model, filter] of plan) {
    const n = await model.countDocuments(filter);
    console.log(`  ${CONFIRM ? "delete" : "would delete"} ${String(n).padStart(4)}  ${name}`);
    if (CONFIRM && n > 0) await model.deleteMany(filter);
  }

  // --- demo staff accounts (never the admin) ------------------------------
  const demoUsers = await (User as any).find({ email: { $in: DEMO_USER_EMAILS.filter((e) => e !== adminEmail) } });
  const demoUserIds = demoUsers.map((u: any) => u._id);
  const demoDentistIds = (await (Dentist as any).find({ user_id: { $in: demoUserIds } }).select("_id").lean()).map((d: any) => d._id);
  const demoSchoolIds = (await (School as any).find({ school_name: { $in: DEMO_SCHOOLS } }).select("_id").lean()).map((s: any) => s._id);

  // AuditTrail and DentistRotation used to be cleared WHOLESALE (`{}`), the one
  // part of this script not scoped by foreign key. Both are now scoped:
  //
  //  - AuditTrail is polymorphic (affected_record_id + affected_model, no ref),
  //    so "belongs to the demo data" means either the record it describes is
  //    being deleted, or the staff account that performed it is. Anything else
  //    -- an action on one of the archived test students, or on a hand-encoded
  //    record -- is real history and now SURVIVES a purge.
  //  - DentistRotation is scoped by the demo dentist or the demo schools.
  //
  // ⚠ This does NOT preserve the Sprint 31 "dentist validated: accepted AI
  // suggestion Medium" row that Chapter 4 relies on: it describes a demo
  // RiskStratification which this script deletes by design, and it was
  // performed by the demo dentist, so it matches both clauses. Scoping is
  // about correctness, not preservation -- run `npm run backup:raw` first if
  // that evidence still matters.
  const staffPlan: [string, any, Record<string, unknown>][] = [
    ["Dentist",          Dentist,          { user_id: { $in: demoUserIds } }],
    ["DentalAide",       DentalAide,       { user_id: { $in: demoUserIds } }],
    ["DentistRotation",  DentistRotation,  { $or: [{ dentist_id: { $in: demoDentistIds } }, { school_id: { $in: demoSchoolIds } }] }],
    ["AuditTrail",       AuditTrail,       { $or: [{ affected_record_id: { $in: auditTargetIds } }, { user_id: { $in: demoUserIds } }] }],
    ["User (demo staff)", User,            { _id: { $in: demoUserIds } }],
    ["User (archived @floral.local)", User, { email: { $regex: TEST_USER_EMAIL_RE }, isArchived: true }],
  ];
  console.log("");
  for (const [name, model, filter] of staffPlan) {
    const n = await model.countDocuments(filter);
    console.log(`  ${CONFIRM ? "delete" : "would delete"} ${String(n).padStart(4)}  ${name}`);
    if (CONFIRM && n > 0) await model.deleteMany(filter);
  }

  // Dentist/DentalAide are scoped by user_id above, so a User deleted by any
  // OTHER route leaves its role record permanently unreachable — this script
  // could never match it again. Found during the Sprint 116 rehearsal, where an
  // earlier test deleted the demo users directly and left exactly that pair
  // behind. Sweep them by broken reference rather than by name.
  {
    const liveUserIds = new Set(
      (await (User as any).find({}).select("_id").lean()).map((u: any) => String(u._id))
    );
    for (const [label, model] of [["Dentist", Dentist], ["DentalAide", DentalAide]] as [string, any][]) {
      const stale = (await model.find({}).select("_id user_id").lean()).filter(
        (r: any) => !liveUserIds.has(String(r.user_id))
      );
      if (stale.length === 0) continue;
      console.log(`  ${CONFIRM ? "delete" : "would delete"} ${String(stale.length).padStart(4)}  ${label} (orphaned — user already gone)`);
      if (CONFIRM) await model.deleteMany({ _id: { $in: stale.map((r: any) => r._id) } });
    }
  }

  // --- schools -------------------------------------------------------------
  // The three real schools are never deleted (see DEMO_SCHOOLS above). Test
  // schools are, but only when nothing still points at them — a school with a
  // surviving student is a referential break, not a cleanup.
  console.log("");
  const testSchools = (await (School as any).find({}).lean()).filter((s: any) =>
    TEST_SCHOOL_NAME_RE.test(String(s.school_name ?? ""))
  );
  if (testSchools.length === 0) {
    console.log("  no test schools to remove");
  }
  for (const s of testSchools) {
    const stillReferenced = await (Student as any).countDocuments({ school_id: s._id });
    if (stillReferenced > 0) {
      console.log(`  SKIP  ${s.school_name} — ${stillReferenced} student(s) still reference it`);
      continue;
    }
    console.log(`  ${CONFIRM ? "delete" : "would delete"}     1  School "${s.school_name}"`);
    if (CONFIRM) await (School as any).deleteOne({ _id: s._id });
  }
  console.log(`  KEPT ${DEMO_SCHOOLS.length} real schools (reference data, never purged)`);

  // Safety net: nothing surviving may point at a school that is gone.
  const remainingSchoolIds = new Set(
    (await (School as any).find({}).select("_id").lean()).map((s: any) => String(s._id))
  );
  const survivors = await (Student as any).find({}).select("_id school_id").lean();
  const orphans = survivors.filter(
    (s: any) => !demoStudents.some((d: any) => String(d._id) === String(s._id)) && !remainingSchoolIds.has(String(s.school_id))
  );
  if (orphans.length > 0) {
    console.log(`\n  ⚠ ${orphans.length} surviving student(s) would point at a DELETED school — investigate before --confirm.`);
  }

  const adminStillThere = await (User as any).countDocuments({ email: adminEmail });
  console.log(`\nAdmin account intact: ${adminStillThere === 1 ? "YES" : "NO — STOP, INVESTIGATE"}`);
  console.log(CONFIRM ? "\nPurged. Reseed with: seed:demo → seed:students → seed:rpc-visit2 → seed:iptr-details" : "\nDry run only. Nothing was deleted.");
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
