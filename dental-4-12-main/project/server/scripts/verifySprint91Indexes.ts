// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import {
  StudentIptr,
  MedicalHistory,
  DietarySocialHabits,
  OralHealthCondition,
  DentalChart,
  Treatment,
  PreventiveCareRecord,
  ToothRecord,
  Student,
  Appointment,
  School,
  User,
  RiskStratification,
  AuditTrail,
} from "../models/index.js";
import mongoose from "mongoose";

/**
 * Sprint 91 — proves the declared indexes EXIST IN MONGODB and that the
 * planner actually uses them.
 *
 * Declaring `schema.index(...)` proves nothing on its own: Mongoose only builds
 * indexes if `autoIndex` is on, and an index the query planner ignores is pure
 * write cost. So this checks both halves — the index is present in the
 * collection, and the representative query reports an IXSCAN rather than a
 * COLLSCAN.
 *
 * Read-only: creates and changes nothing.
 *
 * Run with: npx tsx server/scripts/verifySprint91Indexes.ts
 */

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

/** The winning plan's stage names, innermost first. */
function stages(explain: any): string[] {
  const out: string[] = [];
  let stage = explain?.queryPlanner?.winningPlan;
  // Newer servers wrap the plan under queryPlan; handle both.
  stage = stage?.queryPlan ?? stage;
  while (stage) {
    if (stage.stage) out.push(stage.stage);
    stage = stage.inputStage;
  }
  return out;
}

async function expectIndexScan(
  label: string,
  model: mongoose.Model<any>,
  filter: Record<string, unknown>,
) {
  const explain = await model.find(filter).explain("queryPlanner");
  const plan = stages(Array.isArray(explain) ? explain[0] : explain);
  check(
    `${label}: planner uses an index, not a collection scan`,
    plan.includes("IXSCAN") && !plan.includes("COLLSCAN"),
    plan.join(" <- ") || "no plan",
  );
}

async function expectIndexPresent(label: string, model: mongoose.Model<any>, keys: string[]) {
  const indexes = await model.collection.indexes();
  const found = indexes.some((i: any) => JSON.stringify(Object.keys(i.key)) === JSON.stringify(keys));
  check(
    `${label}: index on { ${keys.join(", ")} } exists in MongoDB`,
    found,
    indexes.map((i: any) => Object.keys(i.key).join("+")).join(" | "),
  );
}

/** Models deliberately left WITHOUT a PERFORMANCE index — asserted so a later
 *  blanket pass has to argue with a test rather than quietly add write cost.
 *
 *  ⚠ `unique: true` indexes are exempt, and that is not a loophole: they are a
 *  CORRECTNESS CONSTRAINT the database enforces, not a query optimisation.
 *  User.email has one, and removing it would let two accounts share an email. */
async function expectNoPerformanceIndexes(label: string, model: mongoose.Model<any>) {
  const indexes = await model.collection.indexes();
  const extra = indexes.filter((i: any) => Object.keys(i.key).join() !== "_id" && !i.unique);
  check(`${label}: no performance index beyond _id, deliberately`, extra.length === 0,
    extra.map((i: any) => Object.keys(i.key).join("+")).join(" | "));
}

async function run() {
  await connectDB();
  announceTarget("verifySprint91Indexes");
  console.log(`\nSprint 91 index verification — db: ${mongoose.connection.name}\n`);

  // ⚠ WAIT FOR THE INDEX BUILDS. Mongoose builds declared indexes in the
  // BACKGROUND when a model is first used, so checking straight after
  // connecting is a race — the first run of this script reported
  // { student_id, school_year } missing when it was merely still building, and
  // a re-run minutes later passed with no code change. `init()` resolves once
  // the build has finished, which makes the result mean something.
  const ALL: mongoose.Model<any>[] = [
    StudentIptr as any, MedicalHistory as any, DietarySocialHabits as any,
    OralHealthCondition as any, DentalChart as any, Treatment as any,
    PreventiveCareRecord as any, ToothRecord as any, Student as any,
    Appointment as any, School as any, User as any,
    RiskStratification as any, AuditTrail as any,
  ];
  await Promise.all(ALL.map((m) => m.init()));

  const iptrChildren: [string, mongoose.Model<any>][] = [
    ["MedicalHistory", MedicalHistory as any],
    ["DietarySocialHabits", DietarySocialHabits as any],
    ["OralHealthCondition", OralHealthCondition as any],
    ["DentalChart", DentalChart as any],
    ["Treatment", Treatment as any],
    ["PreventiveCareRecord", PreventiveCareRecord as any],
  ];

  // A real id to filter on, so the planner sees the query shape the app sends.
  const anyIptr = await StudentIptr.findOne({ isArchived: false }).select("_id student_id").lean();
  const anyChart = await DentalChart.findOne({ isArchived: false }).select("_id").lean();
  if (!anyIptr || !anyChart) {
    console.log("  (no IPTR or chart in the database — cannot explain a realistic query)");
  }

  await expectIndexPresent("StudentIptr", StudentIptr as any, ["isArchived", "student_id"]);
  await expectIndexPresent("StudentIptr", StudentIptr as any, ["student_id", "school_year"]);
  if (anyIptr) {
    await expectIndexScan("StudentIptr by student", StudentIptr as any,
      { isArchived: false, student_id: (anyIptr as any).student_id });
    // The uniqueness check behind uniqueBy — no isArchived, so it needs the
    // SECOND index. This is the one that would regress if someone "tidied"
    // the two indexes into one.
    await expectIndexScan("StudentIptr uniqueness check (no isArchived)", StudentIptr as any,
      { student_id: (anyIptr as any).student_id, school_year: "2025-2026" });
  }

  for (const [name, model] of iptrChildren) {
    await expectIndexPresent(name, model, ["isArchived", "iptr_id"]);
    if (anyIptr) {
      await expectIndexScan(`${name} by iptr`, model, { isArchived: false, iptr_id: (anyIptr as any)._id });
    }
  }

  await expectIndexPresent("ToothRecord", ToothRecord as any, ["isArchived", "chart_id"]);
  if (anyChart) {
    await expectIndexScan("ToothRecord by chart", ToothRecord as any,
      { isArchived: false, chart_id: (anyChart as any)._id });
  }

  // Sprint 56's indexes must survive.
  await expectIndexPresent("Student", Student as any, ["isArchived", "school_id", "grade_level", "section"]);
  await expectIndexPresent("Student", Student as any, ["isArchived", "school_id", "birthday"]);
  await expectIndexPresent("Appointment", Appointment as any, ["isArchived", "appointment_datetime"]);

  // ⚠ Deliberately NOT indexed. School and User hold single-digit to
  // low-double-digit rows, and RiskStratification is only ever read whole — an
  // index on a filter nothing narrows is write cost for nothing.
  for (const [name, model] of [
    ["School", School], ["User", User], ["RiskStratification", RiskStratification],
  ] as [string, mongoose.Model<any>][]) {
    await expectNoPerformanceIndexes(name, model);
  }

  // ⚠ AuditTrail MOVED OUT of the not-indexed list in Sprint 92, and the move
  // is the point: Sprint 91 left it unindexed because nothing narrowed the
  // collection, which was true then. Sprint 92 bounded the route on
  // `timestamp`, creating the query shape that earns the index. The rule did
  // not bend — the query changed.
  await expectIndexPresent("AuditTrail", AuditTrail as any, ["timestamp"]);
  await expectIndexScan("AuditTrail windowed read", AuditTrail as any,
    { timestamp: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } });

  console.log(`\n${pass}/${pass + fail} passed\n`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
