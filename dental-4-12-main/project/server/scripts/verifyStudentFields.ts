import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Student from "../models/Student.js";
import { announceTarget } from "./announceTarget.js";

// Round-trips `place_of_birth` and `guardian_occupation` on ONE existing dev
// record and puts it back, to prove the Sprint 174 schema paths actually
// persist rather than being dropped silently the way they were before.
//
// ⚠ Uses findById + save, NOT findByIdAndUpdate: these two fields are
// encrypted, and the encryption hooks run on save (Sprint 8's rule for every
// encrypted model). It also re-reads through the model rather than `.lean()`,
// because `.lean()` on an encrypted model returns `<iv>:<ciphertext>` with a
// 200 and no error (the Sprint 118 trap) — which would make a broken write
// look like a working one here.
//
//   npx tsx server/scripts/verifyStudentFields.ts <studentId>

const ID = process.argv[2];

async function run() {
  if (!ID) {
    console.error("Usage: npx tsx server/scripts/verifyStudentFields.ts <studentId>");
    process.exit(1);
  }
  await connectDB();
  // ⚠ AFTER connectDB, never before: it prints "(unknown host)" otherwise
  // and tells you nothing, which is worse than not printing at all.
  announceTarget("verify:student-fields");

  const before = await Student.findById(ID);
  if (!before) {
    console.error(`No student ${ID}`);
    process.exit(1);
  }
  const originalPob = before.get("place_of_birth") ?? "";
  const originalOcc = before.get("guardian_occupation") ?? "";
  console.log(`before   place_of_birth=${JSON.stringify(originalPob)} guardian_occupation=${JSON.stringify(originalOcc)}`);

  before.set("place_of_birth", "Taguig City");
  before.set("guardian_occupation", "Tindera");
  await before.save();

  const after = await Student.findById(ID);
  const wrotePob = after?.get("place_of_birth");
  const wroteOcc = after?.get("guardian_occupation");
  console.log(`written  place_of_birth=${JSON.stringify(wrotePob)} guardian_occupation=${JSON.stringify(wroteOcc)}`);

  const persisted = wrotePob === "Taguig City" && wroteOcc === "Tindera";
  // A ciphertext leaking through would look like "<hex>:<hex>" — if that shows
  // up here the decrypt hook did not run and the value is not really readable.
  const looksEncryptedOnRead = /^[0-9a-f]{16,}:/.test(String(wrotePob));

  // Put the record back exactly as found.
  after!.set("place_of_birth", originalPob);
  after!.set("guardian_occupation", originalOcc);
  await after!.save();
  const restored = await Student.findById(ID);
  console.log(`restored place_of_birth=${JSON.stringify(restored?.get("place_of_birth") ?? "")} guardian_occupation=${JSON.stringify(restored?.get("guardian_occupation") ?? "")}`);

  console.log(`\nPERSISTS: ${persisted}`);
  console.log(`READS BACK DECRYPTED: ${!looksEncryptedOnRead}`);

  await mongoose.disconnect();
  process.exit(persisted && !looksEncryptedOnRead ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
