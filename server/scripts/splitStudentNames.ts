import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Student from "../models/Student.js";

// One-off migration: split each STUDENT's single `full_name` into
// last_name / first_name / middle_name (Sprint 35).
//
// Dry-run by default — prints the proposed split for every student and writes
// NOTHING. Pass --confirm to save. Run backupRaw.ts first; this rewrites
// encrypted PII.
//
//   npx tsx server/scripts/splitStudentNames.ts            (dry run)
//   npx tsx server/scripts/splitStudentNames.ts --confirm  (writes)
//
// Sprint 26 random-IV rule: encrypted fields cannot be queried by plaintext, so
// this loads every student and works in JS — same as seedStudents/seedRpcVisit2.

// Suffixes belong with the surname, not the given name: "Ana Reyes Jr." must
// not split to last_name "Jr.".
const SUFFIXES = /^(jr|sr|ii|iii|iv|v)\.?$/i;

// Filipino/Spanish surname particles bind to the token(s) after them:
// "Maria dela Cruz" is surname "dela Cruz", not middle "dela" + surname "Cruz".
const PARTICLES = new Set(["de", "del", "dela", "delas", "delos", "san", "santa", "sto", "sta", "vda"]);

export type SplitName = { first_name: string; middle_name: string; last_name: string; note?: string };

export function splitFullName(fullName: string): SplitName {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first_name: "", middle_name: "", last_name: "", note: "EMPTY name" };

  // Peel a trailing suffix off first; it rejoins the surname at the end.
  let suffix = "";
  if (tokens.length > 1 && SUFFIXES.test(tokens[tokens.length - 1])) {
    suffix = tokens.pop() as string;
  }

  if (tokens.length === 1) {
    // Single token: cannot know whether it is a given name or a surname.
    return {
      first_name: "",
      middle_name: "",
      last_name: [tokens[0], suffix].filter(Boolean).join(" "),
      note: "SINGLE TOKEN — treated as surname, needs a human check",
    };
  }

  // Find where the surname starts: the earliest particle that still leaves at
  // least a first name in front of it.
  let surnameStart = tokens.length - 1;
  for (let i = 1; i < tokens.length - 1; i++) {
    if (PARTICLES.has(tokens[i].toLowerCase())) {
      surnameStart = i;
      break;
    }
  }

  const first_name = tokens[0];
  const middle_name = tokens.slice(1, surnameStart).join(" ");
  const last_name = [tokens.slice(surnameStart).join(" "), suffix].filter(Boolean).join(" ");

  // A 3+ token name with no particle is genuinely ambiguous: "Maria Clara Cruz"
  // could be first+middle+last or a two-word given name. Flag, do not guess
  // silently — the operator can correct it in the UI afterwards.
  const note =
    middle_name && surnameStart === tokens.length - 1
      ? "AMBIGUOUS — middle name assumed; verify against the paper form"
      : undefined;

  return { first_name, middle_name, last_name, note };
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  await connectDB();

  // Includes archived students on purpose: an archived record still has a name
  // and a System Admin can restore it, so it must not be left unmigrated.
  const students = await Student.find({});
  console.log(`${students.length} student(s) found.\n`);

  let willWrite = 0;
  let skipped = 0;
  const flagged: string[] = [];

  for (const s of students as any[]) {
    if (s.last_name && s.first_name) {
      skipped++;
      continue; // already migrated — safe to re-run
    }
    const split = splitFullName(s.full_name ?? "");
    const flag = split.note ? `   <-- ${split.note}` : "";
    console.log(
      `"${s.full_name}"\n    last="${split.last_name}"  first="${split.first_name}"  middle="${split.middle_name}"${flag}`,
    );
    if (split.note) flagged.push(`${s.full_name} — ${split.note}`);

    if (confirm) {
      s.last_name = split.last_name;
      s.first_name = split.first_name;
      s.middle_name = split.middle_name;
      // findById + save (never findByIdAndUpdate) so the encryption hooks run.
      await s.save();
    }
    willWrite++;
  }

  console.log(`\n${skipped} already had name parts (skipped).`);
  if (flagged.length) {
    console.log(`\n${flagged.length} name(s) need a human check:`);
    for (const f of flagged) console.log(`  - ${f}`);
  }
  console.log(
    confirm
      ? `\nWROTE name parts for ${willWrite} student(s).`
      : `\nDRY RUN — nothing written. ${willWrite} student(s) would be updated. Re-run with --confirm to apply.`,
  );

  await mongoose.disconnect();
}

// Only run when invoked directly. seedStudents.ts imports splitFullName from
// here, and without this guard that import would run the whole migration.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("splitStudentNames.ts");
if (invokedDirectly) {
  main().catch(async (err) => {
    console.error(err);
    try { await mongoose.disconnect(); } catch { /* already down */ }
    process.exit(1);
  });
}
