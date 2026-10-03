// Must precede any driver import: Node 24 on one dev machine fails the Atlas
// SRV lookup without it (querySrv ECONNREFUSED).
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import {
  StudentIptr,
  DentalChart,
  ToothRecord,
  MedicalHistory,
  DietarySocialHabits,
  OralHealthCondition,
  PreventiveCareRecord,
  Treatment,
} from "../models/index.js";
import mongoose from "mongoose";

/**
 * Removes StudentIptr records that duplicate an existing (student_id,
 * school_year) pair AND carry no data of their own.
 *
 * Why this exists: on 2026-07-14 a double-submit on "Add Year" created two
 * 2026-2027 records for one student a second apart. The first was empty, the
 * second got charted. The DMFT History table renders one row per IPTR, so the
 * empty one showed as a repeated school year and inflated "Years tracked" --
 * visible in Chapter 4 figure fig-4.1.3c.
 *
 * This is a HARD DELETE, and that is deliberate. The app itself must never hard
 * delete (see CLAUDE.md); this is maintenance tooling run from a developer
 * machine, never shipped to a clinic user. Archiving instead would leave the
 * document in place, and a restore would resurrect the duplicate.
 *
 * SAFETY: it deletes only records that are BOTH duplicates AND provably empty
 * -- no chart, tooth record, medical history, dietary habits, oral condition,
 * preventive care record or treatment. Anything carrying data is reported and
 * left alone. Dry run by default; pass --confirm to actually delete.
 */
const CONFIRM = process.argv.includes("--confirm");

async function childCounts(iptrId: any) {
  const charts = await (DentalChart as any).find({ iptr_id: iptrId }).lean();
  let teeth = 0;
  for (const c of charts) teeth += await (ToothRecord as any).countDocuments({ chart_id: c._id });
  return {
    charts: charts.length,
    teeth,
    medical: await (MedicalHistory as any).countDocuments({ iptr_id: iptrId }),
    dietary: await (DietarySocialHabits as any).countDocuments({ iptr_id: iptrId }),
    oral: await (OralHealthCondition as any).countDocuments({ iptr_id: iptrId }),
    preventive: await (PreventiveCareRecord as any).countDocuments({ iptr_id: iptrId }),
    treatments: await (Treatment as any).countDocuments({ iptr_id: iptrId }),
  };
}

async function main() {
  await connectDB();
  console.log(`db: ${mongoose.connection.name}`);
  console.log(CONFIRM ? "MODE: DELETING\n" : "MODE: dry run (pass --confirm to delete)\n");

  const all = await (StudentIptr as any).find({}).lean();
  const groups = new Map<string, any[]>();
  for (const i of all) {
    const key = `${String(i.student_id)}::${i.school_year}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }

  let deleted = 0;
  let kept = 0;
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const [, year] = key.split("::");
    console.log(`Duplicate: student ${key.split("::")[0]} year ${year} (${rows.length} records)`);

    const withCounts = [];
    for (const r of rows) withCounts.push({ r, c: await childCounts(r._id) });
    const empty = withCounts.filter(({ c }) => Object.values(c).every((n) => n === 0));

    // Never delete every copy: if they are all empty, keep the oldest.
    const toDelete = empty.length === withCounts.length ? empty.slice(1) : empty;

    for (const { r, c } of withCounts) {
      const isTarget = toDelete.some((t) => String(t.r._id) === String(r._id));
      const summary = `charts=${c.charts} teeth=${c.teeth} med=${c.medical} diet=${c.dietary} oral=${c.oral} prev=${c.preventive} treat=${c.treatments}`;
      console.log(`   ${isTarget ? "DELETE" : "keep  "} ${r._id}  ${summary}`);
    }

    for (const { r } of toDelete) {
      if (CONFIRM) await (StudentIptr as any).deleteOne({ _id: r._id });
      deleted++;
    }
    kept += withCounts.length - toDelete.length;
  }

  console.log(
    `\n${CONFIRM ? "Deleted" : "Would delete"} ${deleted} empty duplicate${deleted !== 1 ? "s" : ""}; kept ${kept}.`,
  );
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
