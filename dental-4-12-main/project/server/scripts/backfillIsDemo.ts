/**
 * One-off migration (Sprint 117): set is_demo on the students that already
 * exist, so purgeDemoData.ts can stop relying on a hardcoded name list.
 *
 * Marks true where the record is either on the seeder's own roster
 * (DEMO_STUDENT_NAMES) or is test junk left by an earlier run
 * (ZZTest / Test NoDate / Intake ZZTest). Everything else keeps the default
 * false — including any hand-encoded record — so a real student can never be
 * marked demo by this script.
 *
 * Dry run by default. Pass --confirm to write.
 *
 * full_name is encrypted with a random IV, so a plaintext equality query can
 * never match; students are fetched and filtered in JS after mongoose decrypts
 * on read (same lesson as seedStudents.ts / purgeDemoData.ts).
 */
import "dotenv/config";
import "../dnsFix.js";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { Student } from "../models/index.js";
import mongoose from "mongoose";
import { DEMO_STUDENT_NAMES } from "./demoStudents.js";

const CONFIRM = process.argv.includes("--confirm");

// Kept identical to purgeDemoData.ts's patterns.
const TEST_STUDENT_NAME_RE = /^(ZZTest|Test NoDate|Intake ZZTest)/i;

async function main() {
  await connectDB();
  announceTarget("backfillIsDemo");
  console.log(`db: ${mongoose.connection.name}`);
  console.log(CONFIRM ? "MODE: WRITING\n" : "MODE: dry run (pass --confirm to write)\n");

  const all = await (Student as any).find({});
  const seeded = all.filter((s: any) => DEMO_STUDENT_NAMES.has(s.full_name));
  const junk = all.filter(
    (s: any) => !DEMO_STUDENT_NAMES.has(s.full_name) && TEST_STUDENT_NAME_RE.test(String(s.full_name ?? ""))
  );
  const real = all.filter(
    (s: any) => !DEMO_STUDENT_NAMES.has(s.full_name) && !TEST_STUDENT_NAME_RE.test(String(s.full_name ?? ""))
  );

  console.log(`  ${String(seeded.length).padStart(4)}  on the seeder roster      -> is_demo = true`);
  console.log(`  ${String(junk.length).padStart(4)}  test junk by name pattern -> is_demo = true`);
  console.log(`  ${String(real.length).padStart(4)}  everything else           -> left as false (REAL)`);

  // Names are encrypted patient data — print ids only, never names.
  if (real.length) {
    console.log("\n  records staying REAL (ids only; names are encrypted patient data):");
    for (const r of real) console.log(`     ${r._id}  created=${r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "?"}`);
  }

  if (!CONFIRM) {
    console.log("\nDry run only. Nothing was written.");
    await mongoose.disconnect();
    return;
  }

  // updateMany by _id: is_demo is not encrypted, so a direct update is safe
  // here and avoids re-saving (and re-encrypting) every PII field.
  const ids = [...seeded, ...junk].map((s: any) => s._id);
  const res = await (Student as any).updateMany({ _id: { $in: ids } }, { $set: { is_demo: true } });
  console.log(`\nmarked ${res.modifiedCount} student(s) as is_demo=true`);

  const stillUnset = await (Student as any).countDocuments({ is_demo: { $exists: false } });
  console.log(`students with no is_demo field remaining: ${stillUnset} (schema default covers reads)`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await mongoose.disconnect();
  process.exit(1);
});
