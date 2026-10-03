import "dotenv/config";
import "../dnsFix.js"; // this machine's Node 24 + Atlas SRV workaround
import { connectDB } from "../config/db.js";
import { StudentIptr, DentalChart, ToothRecord, Dentist } from "../models/index.js";
import mongoose from "mongoose";

/**
 * Seeds SERVICES RENDERED for the demo data (Sprint 98).
 *
 * ⚠ WHY THIS EXISTS: Sprint 90 wired the Program Report's Services Rendered
 * section to `TOOTH_RECORD.treatment_code`, and every figure then read 0 —
 * correctly, because **not one tooth record in the database carried a
 * treatment code** (verified 2026-09-03: all 27 had only a `condition`, and 21
 * of the 23 charts had no tooth records at all). The section was right and the
 * data was empty. This fills it so the form can be demonstrated.
 *
 * ⚠ THIS IS DEMO DATA, WRITTEN INTO THE ONE SHARED DATABASE (Open work 26).
 * It is real rows, like every other seeder, and `purge:demo` removes them with
 * the rest of the demo set before deployment. It CHANGES WHAT CHAPTER 4 FIGURES
 * SHOW — recapture any figure of the Program Report after running it.
 *
 * ⚠ IDEMPOTENT. Re-running adds nothing: charts are matched by (iptr, date) and
 * tooth records by (chart, tooth number). Safe to run twice; it reports what it
 * skipped.
 *
 * Scope: the **2025-2026** IPTRs, because that is the school year the demo
 * roster sits on and the one the reports must be switched to (the picker
 * defaults to the current year, where there is almost nothing).
 *
 * Run with: npm run seed:treatments
 */

const SCHOOL_YEAR = "2025-2026";

/** Deterministic pseudo-variety from an id, so reruns pick the same students.
 *  Same helper as seedIptrDetails.ts. */
function hashIndex(seed: string, mod: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Permanent first molars — where sealants actually go. */
const FIRST_MOLARS = [16, 26, 36, 46];
/** A few anterior/posterior teeth used for restorations and extractions. */
const RESTORABLE = [55, 65, 75, 85, 54, 64];

async function main() {
  await connectDB();
  console.log(`db: ${mongoose.connection.name}\n`);

  const dentist = await Dentist.findOne({ isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
  if (!dentist) {
    console.error("No dentist on file — a dental chart requires dentist_id. Run seed:demo first.");
    await mongoose.disconnect();
    process.exit(1);
  }

  const iptrs = await StudentIptr.find({ school_year: SCHOOL_YEAR, isArchived: false })
    .select("_id")
    .lean();
  console.log(`${iptrs.length} IPTRs on ${SCHOOL_YEAR}\n`);

  let chartsCreated = 0, chartsReused = 0, teethCreated = 0, teethSkipped = 0;

  /** Create (or reuse) a chart for an IPTR on a given date. */
  async function chartFor(iptrId: unknown, date: Date) {
    const existing = await DentalChart.findOne({ iptr_id: iptrId, date_charted: date });
    if (existing) { chartsReused++; return existing; }
    chartsCreated++;
    return DentalChart.create({ iptr_id: iptrId, dentist_id: dentist!._id, date_charted: date });
  }

  /** Record one tooth. `condition` is REQUIRED by the schema, so a tooth that
   *  is merely being treated still needs a finding — sound teeth are '✓',
   *  matching DentalChart's conditionCodes. */
  async function tooth(chartId: unknown, toothNumber: number, condition: string, treatment: string) {
    const existing = await ToothRecord.findOne({ chart_id: chartId, tooth_number: toothNumber });
    if (existing) {
      // Only fill a BLANK treatment; never overwrite a real one.
      if (!existing.treatment_code) {
        existing.treatment_code = treatment;
        await existing.save();
        teethCreated++;
      } else {
        teethSkipped++;
      }
      return;
    }
    await ToothRecord.create({ chart_id: chartId, tooth_number: toothNumber, condition, treatment_code: treatment });
    teethCreated++;
  }

  for (const iptr of iptrs) {
    const id = String(iptr._id);
    // ~85% of the cohort gets seen at all; the rest stay untreated so the
    // report shows a denominator, not a uniform block.
    if (hashIndex(id, 20) < 3) continue;

    // ── Visit 1: examination, prophylaxis, fluoride ─────────────────────────
    const visit1 = new Date(`${SCHOOL_YEAR.slice(0, 4)}-08-15T00:00:00`);
    const chart1 = await chartFor(iptr._id, visit1);
    await tooth(chart1._id, 11, "✓", "OEX");
    await tooth(chart1._id, 21, "✓", "OP");   // 1st scaling
    await tooth(chart1._id, 31, "✓", "FV");   // 1st fluoride application

    // Sealants on the permanent first molars for roughly half the cohort.
    if (hashIndex(id + "pfs", 2) === 0) {
      const count = 2 + hashIndex(id + "n", 3); // 2-4 molars
      for (const t of FIRST_MOLARS.slice(0, count)) await tooth(chart1._id, t, "✓", "PFS");
    }

    // Restorations (ART) where there is decay to restore.
    if (hashIndex(id + "art", 3) === 0) {
      const count = 1 + hashIndex(id + "m", 2); // 1-2 teeth
      for (const t of RESTORABLE.slice(0, count)) await tooth(chart1._id, t, "d", "TR");
    }

    // Extraction is rarer than restoration, as it should be.
    if (hashIndex(id + "x", 7) === 0) await tooth(chart1._id, RESTORABLE[2], "d", "X");

    // ── Visit 2: the 4-6 month recall, ~5 months later ──────────────────────
    // Only some of the cohort returns, which is what makes the form's
    // "1st application" and "2nd application" rows differ — if everyone
    // returned, the two rows would be identical and prove nothing.
    if (hashIndex(id + "v2", 3) === 0) {
      const visit2 = new Date(`${SCHOOL_YEAR.slice(0, 4)}-01-20T00:00:00`);
      visit2.setFullYear(Number(SCHOOL_YEAR.slice(5)));
      const chart2 = await chartFor(iptr._id, visit2);
      await tooth(chart2._id, 41, "✓", "FV");  // 2nd fluoride application
      if (hashIndex(id + "op2", 2) === 0) await tooth(chart2._id, 22, "✓", "OP"); // 2nd scaling
      if (hashIndex(id + "sdf", 3) === 0) await tooth(chart2._id, 51, "d", "SDF");
    }

    // A small group gets SDF at visit 1 as well, so the 1st-application row is
    // not empty while the 2nd has values.
    if (hashIndex(id + "sdf1", 4) === 0) await tooth(chart1._id, 52, "d", "SDF");
  }

  console.log(`charts:  ${chartsCreated} created, ${chartsReused} reused`);
  console.log(`teeth:   ${teethCreated} written, ${teethSkipped} left alone (already had a treatment)`);
  console.log(`\n⚠ Chapter 4 figures of the Program Report are now stale — recapture them.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
