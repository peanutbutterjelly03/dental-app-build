import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";

// SEC-18 fix, 2026-09-11 — reports which accounts are UNSCOPED, i.e. carry an
// empty `school_ids`.
//
// Why this exists: `createUser` read `school_id` (singular, the name Sprint 100
// renamed away) and never read `school_ids`, so mongoose's strict mode dropped
// the write and every account created through the API took the `[]` default.
// `User.ts` documents `[]` as meaning ALL SCHOOLS. The controller is fixed; this
// says whether any account is still carrying the consequence.
//
// ⚠ READ-ONLY. It writes nothing and cannot, so it announces the target but
// does not refuse on production — reading is the whole point, and the accounts
// that most need checking are the live ones.
//
//   npx tsx server/scripts/auditUserSchools.ts
//
// Reading `[]` is only a PROBLEM for a role that is supposed to be scoped.
// system_admin and bho_staff are unscoped BY DESIGN (see User.ts:14 and
// schoolScope.ts), so an empty array on those is correct and is reported as
// such rather than as a fault.
//
// ⚠ The dentist and dental aide are a JUDGEMENT CALL this script deliberately
// does not make for you. CLAUDE.md has one dentist and one aide rotating across
// all three schools, so `[]` is very likely right for them — but if either is
// ever meant to be pinned to a site, an empty array is the same silent grant it
// is for a school_admin. They are listed under REVIEW, not under OK.

/** Roles for which an empty `school_ids` is the intended "all schools". */
const UNSCOPED_BY_DESIGN = new Set(["system_admin", "bho_staff"]);
/** Roles for which an empty `school_ids` is a real finding. */
const MUST_BE_SCOPED = new Set(["school_admin"]);

async function run() {
  await connectDB();
  announceTarget("auditUserSchools");

  // Raw collection, not the model — the same reason migrateUserSchools gives:
  // a leftover `school_id` from before that migration is invisible through the
  // model, which no longer declares it, and that is exactly what we want to see.
  const users = mongoose.connection.collection("users");
  const schools = mongoose.connection.collection("schools");

  const nameById = new Map<string, string>();
  for (const s of await schools.find({}).project({ school_name: 1 }).toArray()) {
    nameById.set(String(s._id), String(s.school_name));
  }

  const docs = await users
    .find({})
    .project({ email: 1, role: 1, full_name: 1, school_ids: 1, school_id: 1, isArchived: 1 })
    .toArray();

  const problems: string[] = [];
  const review: string[] = [];
  const ok: string[] = [];
  const stragglers: string[] = [];

  for (const u of docs) {
    const role = String(u.role ?? "(no role)");
    const ids: unknown[] = Array.isArray(u.school_ids) ? u.school_ids : [];
    const archived = u.isArchived === true ? " [archived]" : "";
    const label = ids.length
      ? ids.map((i) => nameById.get(String(i)) ?? `(unknown school ${String(i)})`).join(", ")
      : "ALL SCHOOLS (empty school_ids)";
    const line = `  ${String(u.email).padEnd(30)} ${role.padEnd(14)} ${label}${archived}`;

    // A leftover singular `school_id` means migrateUserSchools never ran over
    // this document. Worth knowing separately: its value is being ignored by
    // every read in the app.
    if (u.school_id !== undefined) {
      stragglers.push(`  ${String(u.email).padEnd(30)} still has school_id=${String(u.school_id)} — migrateUserSchools has not run over this row`);
    }

    if (ids.length > 0) {
      ok.push(line);
    } else if (MUST_BE_SCOPED.has(role)) {
      problems.push(line);
    } else if (UNSCOPED_BY_DESIGN.has(role)) {
      ok.push(line);
    } else {
      review.push(line);
    }
  }

  const section = (title: string, rows: string[]) => {
    console.log(`${title} (${rows.length})`);
    if (rows.length === 0) console.log("  none");
    else rows.forEach((r) => console.log(r));
    console.log("");
  };

  console.log(`${docs.length} user accounts\n`);
  section("UNSCOPED BUT MUST NOT BE — these are the SEC-18 casualties", problems);
  section("REVIEW — unscoped, and whether that is right is a judgement call", review);
  section("OK — scoped, or unscoped by design", ok);
  section("MIGRATION STRAGGLERS — a leftover singular school_id, value ignored by the app", stragglers);

  if (problems.length > 0) {
    console.log(`FAIL: ${problems.length} account(s) hold every school when they should hold one.`);
    console.log("Fix by editing each in Account Management and selecting the right school(s) —");
    console.log("the edit path writes school_ids correctly and always did.");
    process.exitCode = 1;
  } else {
    console.log("PASS: no account is unscoped that must be scoped.");
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
