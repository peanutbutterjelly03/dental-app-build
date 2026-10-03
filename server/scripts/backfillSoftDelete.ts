// Must precede any driver import: on Node 24 this machine's local resolver
// stub fails the Atlas SRV lookup (querySrv ECONNREFUSED). Same preload
// `server/local.ts` uses -- harmless on machines that don't need it.
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import {
  MedicalHistory,
  DietarySocialHabits,
  OralHealthCondition,
  RiskStratification,
  ToothRecord,
} from "../models/index.js";
import mongoose from "mongoose";

/**
 * Sprint J backfill — RUN ONCE, IMMEDIATELY AFTER DEPLOYING THE SCHEMA CHANGE.
 *
 * These five models gained `isArchived` / `archivedAt` / `archivedBy`. Mongoose
 * applies schema defaults on WRITE, never to documents already stored, so every
 * existing record still has no `isArchived` field at all.
 *
 * That matters because crudFactory filters list queries with
 * `{ isArchived: false }` (`crudFactory.ts:59`), and an exact-match query does
 * NOT match documents where the field is absent. Without this backfill every
 * existing tooth record, medical history, dietary habit, oral-health condition
 * and risk stratification silently disappears from the app — the data is intact
 * in Mongo, but nothing reads it.
 *
 * Writing the field is additive and idempotent: it only touches documents that
 * lack it, sets them to the not-archived state, and can safely be re-run.
 *
 * This is NOT a delete script. It adds three fields and removes nothing.
 */
const MODELS = [
  ["MedicalHistory", MedicalHistory],
  ["DietarySocialHabits", DietarySocialHabits],
  ["OralHealthCondition", OralHealthCondition],
  ["RiskStratification", RiskStratification],
  ["ToothRecord", ToothRecord],
] as const;

async function main() {
  await connectDB();
  console.log(`Connected to: ${mongoose.connection.name}\n`);

  let total = 0;
  for (const [name, model] of MODELS) {
    // Only documents missing the field — already-backfilled records are skipped,
    // and an archived record is never resurrected to isArchived: false.
    const res = await (model as any).updateMany(
      { isArchived: { $exists: false } },
      { $set: { isArchived: false, archivedAt: null, archivedBy: null } },
    );
    const n = res.modifiedCount ?? 0;
    total += n;
    console.log(`${name}: ${n} document${n !== 1 ? "s" : ""} backfilled`);
  }

  console.log(`\nDone. ${total} document${total !== 1 ? "s" : ""} updated.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
