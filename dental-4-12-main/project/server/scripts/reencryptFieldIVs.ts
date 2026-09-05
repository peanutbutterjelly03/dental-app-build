import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Student, DentalAide, MedicalHistory, Treatment } from "../models/index.js";

// Sprint 26 one-time migration: re-encrypt every encrypted field with a fresh
// RANDOM IV. Legacy rows were written under the old fixed saltGenerator (one
// constant IV app-wide), so identical plaintexts share identical ciphertexts.
// Reading a doc decrypts in memory (post('init')); markModified + save()
// re-encrypts through pre('save') with the new random-IV config.
//
// - Idempotent: re-running just re-randomizes IVs again.
// - Includes ARCHIVED docs on purpose (soft-deleted PII must be fixed too).
// - Per-doc read-back assertion: after save, re-fetch and compare decrypted
//   values to the pre-save plaintexts; any mismatch ABORTS the whole run
//   (undecryptable-data canary).
// - TAKE AN ATLAS SNAPSHOT FIRST. Run with: npx tsx server/scripts/reencryptFieldIVs.ts --yes

const TARGETS: { name: string; model: mongoose.Model<any>; fields: string[] }[] = [
  { name: "Student", model: Student, fields: ["full_name", "last_name", "first_name", "middle_name", "address", "contact_number", "guardian_name", "guardian_contact", "philhealth_number", "fourps_id", "place_of_birth", "guardian_occupation"] },
  { name: "DentalAide", model: DentalAide, fields: ["contact_number"] },
  { name: "MedicalHistory", model: MedicalHistory, fields: ["allergies", "others"] },
  { name: "Treatment", model: Treatment, fields: ["diagnosis", "treatment_done"] },
];

async function main() {
  if (!process.env.FIELD_ENCRYPTION_SECRET) throw new Error("FIELD_ENCRYPTION_SECRET is not set");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!process.argv.includes("--yes")) {
    console.log("This rewrites EVERY encrypted record in Atlas with a fresh random IV.");
    console.log("Take an Atlas snapshot first, then re-run with --yes.");
    process.exit(1);
  }

  await connectDB();

  let totalOk = 0;
  const failures: { collection: string; id: string; error: string }[] = [];

  for (const { name, model, fields } of TARGETS) {
    // find({}) deliberately includes isArchived: true docs
    const docs = await model.find({});
    console.log(`\n${name}: ${docs.length} document(s)`);
    let i = 0;
    for (const doc of docs) {
      i++;
      const id = String(doc._id);
      try {
        // capture decrypted plaintexts BEFORE save for the read-back check
        const before: Record<string, unknown> = {};
        for (const f of fields) before[f] = doc.get(f);

        for (const f of fields) doc.markModified(f);
        await doc.save({ validateBeforeSave: false }); // legacy docs may predate newer validators; we change no values

        // read-back canary: a decrypt mismatch means STOP EVERYTHING
        const reread = await model.findById(doc._id);
        if (!reread) throw new Error("document vanished on re-read");
        for (const f of fields) {
          const now = reread.get(f);
          if ((before[f] ?? "") !== (now ?? "")) {
            console.error(`\nFATAL: read-back mismatch on ${name} ${id} field "${f}" — aborting run.`);
            console.error("Existing processed docs are still valid; investigate before re-running.");
            await mongoose.disconnect();
            process.exit(1);
          }
        }
        totalOk++;
        if (i % 25 === 0 || i === docs.length) console.log(`  ${i}/${docs.length}`);
      } catch (err) {
        failures.push({ collection: name, id, error: err instanceof Error ? err.message : String(err) });
        console.warn(`  skip ${name} ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`\nDone. ${totalOk} document(s) re-encrypted with random IVs.`);
  if (failures.length) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  ${f.collection} ${f.id}: ${f.error}`);
  } else {
    console.log("0 failures.");
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
