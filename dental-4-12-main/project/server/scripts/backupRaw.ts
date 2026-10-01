import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";

/*
 * Full raw dump of every collection, to a timestamped JSON folder.
 *
 * Written because there is ONE database (backlog 26): local dev and the
 * deployed Vercel app share it, so `purge:demo --confirm` is irreversible and
 * operates on the live defense data. This is the undo.
 *
 *   npm run backup:raw            -> ./backups/<timestamp>/
 *   npm run backup:raw -- --out X -> X/<timestamp>/
 *
 * RAW MEANS RAW. It reads through the driver, NOT through mongoose models, so
 * encrypted fields are dumped as the stored `<iv>:<ciphertext>` strings
 * exactly as they sit on disk. That is deliberate and it is what makes the
 * dump restorable: mongoose would decrypt on read, and writing that back would
 * double-encrypt on the next save. It also means:
 *
 *   ⚠ THE DUMP IS ONLY READABLE WHILE FIELD_ENCRYPTION_SECRET IS UNCHANGED.
 *     Per CLAUDE.md, changing that secret is the one action that makes records
 *     permanently undecryptable -- that applies to these files too.
 *   ⚠ THE DUMP CONTAINS REAL PATIENT PII once real records are encoded.
 *     ./backups/ is gitignored. Keep it that way; never commit one.
 *
 * Restore is deliberately NOT automated -- an accidental restore is as
 * destructive as an accidental purge. To restore a collection by hand:
 *   mongoimport --uri "$MONGODB_URI" --collection students \
 *     --file backups/<timestamp>/students.json --jsonArray
 */

const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--out");
const OUT_ROOT = outFlag !== -1 && argv[outFlag + 1] ? argv[outFlag + 1] : "backups";

async function main() {
  await connectDB();
  announceTarget("backupRaw");
  const db = mongoose.connection.db;
  if (!db) throw new Error("no database handle after connect");

  // 2026-09-02T14-30-00 — filename-safe, sorts chronologically.
  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const dir = path.resolve(OUT_ROOT, stamp);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`db: ${mongoose.connection.name}`);
  console.log(`out: ${dir}\n`);

  const collections = await db.listCollections().toArray();
  let grandTotal = 0;
  const manifest: Record<string, number> = {};

  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const docs = await db.collection(name).find({}).toArray();
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(docs, null, 2), "utf8");
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`  ${String(docs.length).padStart(5)} docs  ${String(kb).padStart(8)} KB  ${name}`);
    manifest[name] = docs.length;
    grandTotal += docs.length;
  }

  // The manifest is what makes a restore checkable: compare these counts after
  // reimporting, rather than trusting that it worked.
  fs.writeFileSync(
    path.join(dir, "_manifest.json"),
    JSON.stringify({ takenAt: new Date().toISOString(), database: mongoose.connection.name, counts: manifest, total: grandTotal }, null, 2),
    "utf8",
  );

  console.log(`\n${grandTotal} documents across ${collections.length} collections -> ${dir}`);
  console.log("Encrypted fields are stored ciphertext; readable only while FIELD_ENCRYPTION_SECRET is unchanged.");
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
