import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { User } from "../models/index.js";

// Sprint 100 follow-up. `migrateUserSchools.ts` is deliberately LITERAL — it
// copies whatever `school_id` held and invents no policy. That leaves the demo
// dentist still pinned to one school, which is the thing this sprint exists to
// fix: there is ONE dentist and ONE aide covering all three schools.
//
// `seed:demo` cannot do it either — it skips accounts that already exist, so
// its corrected assignments never reach a database that has already been
// seeded (the same trap Sprint 75 hit with passwords).
//
//   npx tsx server/scripts/assignDemoSchools.ts            (dry run)
//   npx tsx server/scripts/assignDemoSchools.ts --confirm  (writes)

const CONFIRM = process.argv.includes("--confirm");

/** Empty array = all schools. */
const ASSIGNMENTS: Record<string, string[]> = {
  "dentist@floral.com": [],
  "aide@floral.com": [],
};

async function run() {
  await connectDB();
  announceTarget("assignDemoSchools");

  for (const [email, school_ids] of Object.entries(ASSIGNMENTS)) {
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`  ${email.padEnd(24)} NOT FOUND — skipped`);
      continue;
    }
    const before = (user.school_ids ?? []).map((s: unknown) => String(s));
    const label = school_ids.length ? `${school_ids.length} school(s)` : "ALL SCHOOLS";
    console.log(`  ${email.padEnd(24)} ${before.length ? `${before.length} school(s)` : "ALL SCHOOLS"} -> ${label}`);

    if (CONFIRM) {
      user.school_ids = school_ids as never;
      await user.save();
    }
  }

  console.log(CONFIRM ? "\nWRITTEN." : "\nDry run — nothing saved. Re-run with --confirm.");
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
