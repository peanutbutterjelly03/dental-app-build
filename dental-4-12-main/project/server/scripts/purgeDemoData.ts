// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import {
  School, User, Dentist, DentalAide, Student, StudentIptr, MedicalHistory,
  DietarySocialHabits, OralHealthCondition, DentalChart, ToothRecord, Treatment,
  PreventiveCareRecord, RiskStratification, Appointment, DentistRotation, AuditTrail,
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
 *  - Students are matched against the exact name list seedStudents.ts creates.
 *    A student encoded by hand is not on that list and is therefore untouchable
 *    by this script, even if it is run by accident against real data.
 *  - Everything else is deleted by FOREIGN KEY from those students / demo users,
 *    never by a blanket query.
 *  - Dry run by default. Pass --confirm to delete.
 *
 * full_name is encrypted with a random IV, so a plaintext equality query can
 * never match; students are fetched and filtered in JS after mongoose decrypts
 * on read (same lesson as seedStudents.ts / seedRpcVisit2.ts).
 */
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

const DEMO_SCHOOLS = [
  "Bagong Tanyag Integrated School",
  "Bagong Tanyag Elementary School Annex A",
  "South Daang Hari Elementary School Main",
];

async function main() {
  await connectDB();
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
  const allStudents = await (Student as any).find({});
  const demoStudents = allStudents.filter((s: any) => DEMO_STUDENT_NAMES.has(s.full_name));
  const foreign = allStudents.length - demoStudents.length;
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
    ["Appointment",         Appointment,         { student_id: { $in: studentIds } }],
    ["StudentIptr",         StudentIptr,         { _id: { $in: iptrIds } }],
    ["Student",             Student,             { _id: { $in: studentIds } }],
  ];

  console.log(`Students: ${demoStudents.length} demo, ${foreign} NOT on the seed list (left alone)\n`);

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
    ["School",           School,           { school_name: { $in: DEMO_SCHOOLS } }],
  ];
  console.log("");
  for (const [name, model, filter] of staffPlan) {
    const n = await model.countDocuments(filter);
    console.log(`  ${CONFIRM ? "delete" : "would delete"} ${String(n).padStart(4)}  ${name}`);
    if (CONFIRM && n > 0) await model.deleteMany(filter);
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
