// Sprint 127 — proves the REFERRAL model behaves, against whichever database
// `.env` points at. Kept rather than thrown away for the reason Sprint 74's
// suite earned its keep: re-running it on dirty state later found a real bug.
//
// Every check STATES WHAT IT COMPARED and throws when a precondition is
// missing, per the 2026-09-04 session lesson — a check that measures nothing
// looks exactly like a check that passes.
//
// ⚠ IT WRITES 4 REAL REFERRALS and removes them again, so it REFUSES to run
// against the production cluster (Sprint 129, from the code review): a run
// against production would put fabricated referrals into real records, and if
// it threw partway they would stay there and be counted on a form filed with
// the City Health Office. `announceTarget` only PRINTS the target — printing is
// not a guard.
//
// The rows it removes are its own fixtures, deleted by the ids it just created,
// never by a query that could match anything else. CLAUDE.md's "never hard
// delete" governs patient records in the app; this is a test fixture that
// existed for four seconds, and leaving it behind would corrupt the very counts
// the next run measures.
import "../dnsFix.js";
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { announceTarget } from "./announceTarget.js";
import { Referral, StudentIptr, Student } from "../models/index.js";
import mongoose from "mongoose";

const results: string[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  // AFTER connectDB: announceTarget reads mongoose.connection.host, which is
  // empty until the connection is open — calling it first prints "(unknown host)"
  // and silently tells you nothing about which database you are on.
  await connectDB();
  const { isProduction, host } = announceTarget("verifyReferrals");
  if (isProduction) {
    throw new Error(
      `REFUSING TO RUN against the production database (${host}). This script writes 4 real ` +
        `referrals. Point .env at the dev cluster and run it there.`,
    );
  }

  const iptrs = await StudentIptr.find({ isArchived: false }).limit(2);
  if (iptrs.length < 1) throw new Error("PRECONDITION FAILED: no StudentIptr rows to attach a referral to");
  const iptr = iptrs[0];
  const student = await Student.findById(iptr.student_id);
  if (!student) throw new Error("PRECONDITION FAILED: IPTR points at no student");
  // ⚠ Stated, not assumed: the count checks below only mean anything if this
  // pupil starts with no referrals. Once someone records one through the
  // Referrals tab, an unasserted run would report a FALSE FAILURE on dirty
  // state — which is exactly the scenario this script exists to survive.
  const preExisting = await Referral.countDocuments({ iptr_id: iptr._id });
  if (preExisting > 0) {
    throw new Error(
      `PRECONDITION FAILED: IPTR ${iptr._id} already has ${preExisting} referral(s). ` +
        `The count checks assume a clean pupil. Pick another IPTR or archive those first.`,
    );
  }
  console.log(`Using IPTR ${iptr._id} (school_year ${iptr.school_year}, grade ${iptr.grade_level})`);

  const REASON = "Suspicious lesion on the lower left buccal mucosa";
  const made = await Referral.create([
    { iptr_id: iptr._id, referral_type: "oral_cancer_screening", date_issued: new Date(), facility_name: "Taguig City Health Office", reason: REASON },
    { iptr_id: iptr._id, referral_type: "surgical", date_issued: new Date(), facility_name: "Ospital ng Makati", reason: "Impacted third molar" },
    { iptr_id: iptr._id, referral_type: "primary_care", date_issued: new Date(), facility_name: "Barangay Health Center", reason: "Prophylaxis follow-up" },
    // A SECOND surgical referral for the same pupil — this is the one that
    // proves the report counts patients rather than slips.
    { iptr_id: iptr._id, referral_type: "surgical", date_issued: new Date(), facility_name: "Ospital ng Makati", reason: "Second surgical referral, same pupil" },
  ]);
  check("create", made.length === 4, `${made.length} referrals written for one IPTR`);

  // 1. reason is ENCRYPTED at rest — read the raw collection, not the model.
  const raw = await mongoose.connection.db!
    .collection("referrals")
    .findOne({ _id: made[0]._id as mongoose.Types.ObjectId });
  if (!raw) throw new Error("PRECONDITION FAILED: raw document not found, cannot judge encryption");
  const rawReason = String(raw.reason ?? "");
  check(
    "reason encrypted at rest",
    rawReason.length > 0 && !rawReason.includes("lesion") && /^[0-9a-f]+:[0-9a-f]+$/.test(rawReason),
    `raw value is "${rawReason.slice(0, 28)}…" (iv:ciphertext shape, plaintext absent)`,
  );
  check(
    "facility_name deliberately NOT encrypted",
    raw.facility_name === "Taguig City Health Office",
    `raw value reads "${raw.facility_name}"`,
  );

  // 2. it decrypts back through the model.
  const back = await Referral.findById(made[0]._id);
  check("reason decrypts", back?.reason === REASON, `model returned "${back?.reason}"`);

  // 3. defaults are the issue-only ones.
  check("status defaults to pending", back?.status === "pending", `status = ${back?.status}`);
  check("follow_up_date defaults null", back?.follow_up_date === null, `follow_up_date = ${back?.follow_up_date}`);
  check("soft-delete fields present", back?.isArchived === false, `isArchived = ${back?.isArchived}`);

  // 4. the enum is enforced.
  let rejected = false;
  try {
    await Referral.create({ iptr_id: iptr._id, referral_type: "made_up_kind", date_issued: new Date(), facility_name: "X", reason: "Y" });
  } catch {
    rejected = true;
  }
  check("enum enforced", rejected, "an out-of-enum referral_type was refused by validation");

  // 5. the report's counting rule — patients, not slips, and higher_level is
  //    the total of itself plus the three sub-kinds.
  const mine = await Referral.find({ iptr_id: iptr._id, isArchived: false });
  const types = new Set(mine.map((r: { referral_type: string }) => r.referral_type));
  const higher =
    types.has("higher_level") || types.has("oral_cancer_screening") || types.has("surgical") || types.has("private_facility");
  check("ref_cancer counts this patient", types.has("oral_cancer_screening"), "one oral-cancer-screening referral on this IPTR");
  check("ref_surgical counts this patient", types.has("surgical"), "one surgical referral on this IPTR");
  check("ref_primary counts this patient", types.has("primary_care"), "one primary-care referral on this IPTR");
  check("ref_higher totals the sub-rows", higher, "cancer + surgical present, so the Higher Level total counts this patient once");
  const surgicalSlips = mine.filter((r: { referral_type: string }) => r.referral_type === "surgical").length;
  check(
    "patients not slips",
    mine.length === 4 && types.size === 3 && surgicalSlips === 2,
    `${mine.length} slips (${surgicalSlips} of them surgical) collapse to ${types.size} counted rows`,
  );

  // 6. indexes actually exist in MongoDB, not merely declared.
  const idx = await mongoose.connection.db!.collection("referrals").indexes();
  const names = idx.map((i) => JSON.stringify(i.key));
  check("iptr_id index built", names.some((n) => n.includes("iptr_id")), names.join(" "));
  check("date_issued index built", names.some((n) => n.includes("date_issued")), names.join(" "));

  // Clean up — this is the DEV database, but a verifier must not leave rows.
  const madeIds = made.map((m) => m._id);
  await Referral.deleteMany({ _id: { $in: madeIds } });
  // Counts ONLY the fixtures this run created — counting every referral on the
  // IPTR would fail the moment a real one exists, which is a false failure.
  const left = await Referral.countDocuments({ _id: { $in: madeIds } });
  check("cleanup", left === 0, `${left} of this run's ${madeIds.length} fixtures left behind`);

  console.log("\n" + results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks passed`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
