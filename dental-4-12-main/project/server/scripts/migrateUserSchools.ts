import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";

// One-off migration: USER.school_id (single FK) -> USER.school_ids (array).
// Sprint 100.
//
// Dry-run by default — prints what it would write and saves NOTHING. Pass
// --confirm to write. Run backupRaw.ts first.
//
//   npx tsx server/scripts/migrateUserSchools.ts            (dry run)
//   npx tsx server/scripts/migrateUserSchools.ts --confirm  (writes)
//
// The mapping is deliberately literal, so re-running it is a no-op:
//   school_id set   -> school_ids: [that id]
//   school_id null  -> school_ids: []      (empty === ALL schools, unchanged
//                                           meaning from before)
// `school_id` is then $unset. Leaving both would give the codebase two sources
// of truth for the same question, and the stale one would eventually be read.
//
// ⚠ Runs against the raw collection, NOT the Mongoose model — the model no
// longer declares `school_id`, so a model-based read would silently return
// undefined for every user and the migration would quietly do nothing.

const CONFIRM = process.argv.includes("--confirm");

async function run() {
  await connectDB();
  announceTarget("migrateUserSchools");
  const users = mongoose.connection.collection("users");
  const schools = mongoose.connection.collection("schools");

  const nameById = new Map<string, string>();
  for (const s of await schools.find({}).project({ school_name: 1 }).toArray()) {
    nameById.set(String(s._id), String(s.school_name));
  }

  const docs = await users.find({}).project({ email: 1, role: 1, school_id: 1, school_ids: 1 }).toArray();
  console.log(`${docs.length} users\n`);

  let planned = 0;
  let already = 0;

  for (const u of docs) {
    if (Array.isArray(u.school_ids) && u.school_id === undefined) {
      already++;
      continue;
    }
    const ids = u.school_id ? [u.school_id] : [];
    const label = ids.length ? ids.map((i: unknown) => nameById.get(String(i)) ?? `(unknown ${String(i)})`).join(", ") : "ALL SCHOOLS";
    console.log(`  ${String(u.email).padEnd(30)} ${String(u.role).padEnd(14)} -> ${label}`);
    planned++;

    if (CONFIRM) {
      await users.updateOne({ _id: u._id }, { $set: { school_ids: ids }, $unset: { school_id: "" } });
    }
  }

  console.log(`\n${planned} to migrate, ${already} already migrated`);
  console.log(CONFIRM ? "WRITTEN." : "Dry run — nothing saved. Re-run with --confirm.");
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
