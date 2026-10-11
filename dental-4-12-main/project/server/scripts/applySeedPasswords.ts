import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import User from "../models/User.js";

// Apply the SEED_*_PASSWORD values from .env to accounts that ALREADY EXIST.
//
// `seed:demo` cannot do this: its `ensureUser` skips any account already in the
// database ("User <email> already exists, skipping"), by design — re-running a
// seeder should not silently reset live credentials. So changing a password in
// .env has no effect on an existing account until something applies it, and
// this is that something.
//
// Dry-run by default; --confirm writes.
//   npx tsx server/scripts/applySeedPasswords.ts            (dry run)
//   npx tsx server/scripts/applySeedPasswords.ts --confirm  (writes)
//
// ⚠ DEMO ACCOUNTS ONLY. This is for the five seeded @floral.com logins used in
// development and at defense. Do NOT point it at real staff accounts: it sets a
// password the operator can read from .env, which is the opposite of what a
// real account needs. At turnover, swap the demo logins for real staff emails
// and let each person set their own password through the reset flow.

const CONFIRM = process.argv.includes("--confirm");

/** email → the env var holding its new password. */
const ACCOUNTS: { email: string; envVar: string }[] = [
  { email: process.env.SEED_ADMIN_EMAIL || "admin@floral.com", envVar: "SEED_ADMIN_PASSWORD" },
  { email: "dentist@floral.com", envVar: "SEED_DENTIST_PASSWORD" },
  { email: "aide@floral.com", envVar: "SEED_AIDE_PASSWORD" },
  { email: "schooladmin@floral.com", envVar: "SEED_SCHOOLADMIN_PASSWORD" },
  { email: "bho@floral.com", envVar: "SEED_BHO_PASSWORD" },
];

async function run() {
  await connectDB();
  announceTarget("applySeedPasswords");

  let updated = 0;
  let missingAccount = 0;
  let missingEnv = 0;

  for (const { email, envVar } of ACCOUNTS) {
    const password = process.env[envVar];
    if (!password) {
      console.log(`  SKIP  ${email} — ${envVar} is not set in .env`);
      missingEnv++;
      continue;
    }
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`  SKIP  ${email} — no such account`);
      missingAccount++;
      continue;
    }
    // Never print the password itself, only that it changed.
    console.log(`  ${CONFIRM ? "SET " : "WOULD SET"}  ${email}  (from ${envVar})`);
    if (CONFIRM) {
      // Same cost factor the app uses when it hashes elsewhere.
      (user as any).password_hash = await bcrypt.hash(password, 10);
      await user.save();
    }
    updated++;
  }

  console.log(`\n${updated} account(s) ${CONFIRM ? "updated" : "would be updated"}`);
  if (missingAccount) console.log(`${missingAccount} not found in the database`);
  if (missingEnv) console.log(`${missingEnv} had no password set in .env`);
  if (!CONFIRM) console.log(`\nDRY RUN — nothing was written. Re-run with --confirm to apply.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
