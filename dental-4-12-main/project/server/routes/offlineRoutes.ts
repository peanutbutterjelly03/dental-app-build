import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { CLINICAL_READ_ROLES } from "../middleware/roleGroups.js";
import { scopeFilter } from "../utils/schoolScope.js";
import { decryptForResponse } from "./crudFactory.js";
import {
  Student, StudentIptr, MedicalHistory, DietarySocialHabits, OralHealthCondition,
  DentalChart, ToothRecord, Treatment, PreventiveCareRecord, Referral, AuditTrail,
} from "../models/index.js";

// Everything the Dental Chart needs to open, for one PAGE of students, in one
// request. This is what lets a device hold EVERY student's chart for offline use
// (src/app/offline/bulkSync.ts) instead of only the ones somebody opened online.
//
// Why a purpose-built route and not the ordinary lists: opening one chart makes
// about a dozen reads, so 8,000 students would be ~100,000 requests; and the
// unfiltered lists would each be tens of MB, past a serverless response limit.
// A page of students keeps each answer small (~1 MB at 100 students) and the
// whole roster takes ~80 requests.
//
// READ-ONLY, and no looser than the routes it stands in for: the same roles that
// may read clinical records (not the School Administrator, not BHO staff), the
// same school scoping (`scopeFilter("Student")` bounds the students, and every
// other record is reached THROUGH those students, so nothing outside the
// caller's schools can come back), archived records excluded, encrypted fields
// decrypted exactly as the normal reads decrypt them.

const MAX_PAGE = 200;
const DEFAULT_PAGE = 100;

const router = Router();

// The models whose records the bundle carries (their `modelName`s, as the audit
// trail stores them in `affected_model`).
const BUNDLED_MODELS = [
  "Student", "StudentIptr", "MedicalHistory", "DietarySocialHabits", "OralHealthCondition",
  "DentalChart", "ToothRecord", "Treatment", "PreventiveCareRecord", "Referral",
];

// GET /api/offline/version -> { at }
// When anything the bundle contains last changed (create, edit, archive, restore).
// A device compares it with the value saved at its last COMPLETE download and skips
// the whole download when they match.
//
// ⚠ NOT /stats/last-change. That one is the newest audit entry of ANY kind, and
// every sign-in writes a "Login" entry, so it moves whenever anyone anywhere signs
// in: used here it would re-download every student on almost every sign-in.
// Narrowed to these models; a change it misses (written outside the app, so not
// audited) is caught by the next change that is.
router.get(
  "/version",
  requireAuth,
  requireRole(...CLINICAL_READ_ROLES),
  asyncHandler(async (_req, res) => {
    const latest = await AuditTrail.findOne({ affected_model: { $in: BUNDLED_MODELS } })
      .sort({ timestamp: -1 })
      .select("timestamp")
      .lean<{ timestamp: Date } | null>();
    res.json({ at: latest?.timestamp ?? null });
  }),
);

// GET /api/offline/bundle?after=<studentId>&limit=100
//   -> { students, "student-iptrs", "medical-histories", ..., next, total? }
// Walk it by passing the previous answer's `next` as `after` until `next` is null.
// `total` (students in scope) comes only with the first page, for a progress bar.
router.get(
  "/bundle",
  requireAuth,
  requireRole(...CLINICAL_READ_ROLES),
  asyncHandler(async (req, res) => {
    const after = req.query.after;
    if (after !== undefined && (typeof after !== "string" || !mongoose.isValidObjectId(after))) {
      res.status(400).json({ error: "Invalid after" });
      return;
    }
    const asked = Number(req.query.limit);
    const limit = Number.isInteger(asked) ? Math.min(MAX_PAGE, Math.max(1, asked)) : DEFAULT_PAGE;

    const base: Record<string, unknown> = { isArchived: false };
    const scope = await scopeFilter("Student", req);
    const everyone = scope ? { $and: [base, scope] } : base;
    const page = after ? { $and: [everyone, { _id: { $gt: after } }] } : everyone;

    const students = await Student.find(page).sort({ _id: 1 }).limit(limit);
    const studentIds = students.map((s) => s._id);
    const iptrs = await StudentIptr.find({ student_id: { $in: studentIds }, isArchived: false });
    const iptrIds = iptrs.map((i) => i._id);

    const byIptr = (model: mongoose.Model<any>) => model.find({ iptr_id: { $in: iptrIds }, isArchived: false });
    const [medical, diet, oral, charts, treatments, preventives, referrals] = await Promise.all([
      byIptr(MedicalHistory), byIptr(DietarySocialHabits), byIptr(OralHealthCondition), byIptr(DentalChart),
      byIptr(Treatment), byIptr(PreventiveCareRecord), byIptr(Referral),
    ]);
    const teeth = await ToothRecord.find({ chart_id: { $in: charts.map((c) => c._id) }, isArchived: false });

    // decryptForResponse first, while each is still a Mongoose document (same as
    // the ordinary list routes), then the plain object goes out.
    const plain = (docs: any[]) => docs.map((d) => decryptForResponse(d));
    const total = after ? undefined : await Student.countDocuments(everyone);

    res.json({
      students: plain(students),
      "student-iptrs": plain(iptrs),
      "medical-histories": plain(medical),
      "dietary-social-habits": plain(diet),
      "oral-health-conditions": plain(oral),
      "dental-charts": plain(charts),
      "tooth-records": plain(teeth),
      "preventive-care-records": plain(preventives),
      treatments: plain(treatments),
      referrals: plain(referrals),
      // A short page is the last one; a full page may or may not be.
      next: students.length === limit ? String(students[students.length - 1]._id) : null,
      ...(total === undefined ? {} : { total }),
    });
  }),
);

export default router;
