import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { CLINICAL_WRITE_ROLES, ADMIN_ONLY } from "../middleware/roleGroups.js";
import { isInScope } from "../utils/schoolScope.js";
import { logAudit } from "../utils/auditLog.js";
import { sanitizeBody, decryptForResponse } from "./crudFactory.js";
import {
  SyncConflict, User, Student, StudentIptr, MedicalHistory, DietarySocialHabits, OralHealthCondition,
  DentalChart, ToothRecord, Treatment, PreventiveCareRecord, Referral,
} from "../models/index.js";

// Review and resolve the offline edits the server held back (crudFactory's PUT,
// utils/syncConflict.ts). Reachable by the people who can write clinical records
// (and nobody else), and a record must be inside the caller's schools: the same
// two gates the record's own routes apply, so this can never be a side door.

// Only the models the offline modules edit. An allowlist, not "any model name":
// the resource comes from the URL and from a stored row.
const RESOURCES: Record<string, mongoose.Model<any>> = {
  Student, StudentIptr, MedicalHistory, DietarySocialHabits, OralHealthCondition,
  DentalChart, ToothRecord, Treatment, PreventiveCareRecord, Referral,
};

const parseJson = (text: unknown): Record<string, unknown> => {
  try {
    const value = JSON.parse(String(text ?? "{}"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

/** A pending row, as the review screen needs it. */
async function present(row: any) {
  const owner = await User.findById(row.owner_id).select("full_name role").lean<{ full_name?: string; role?: string }>();
  return {
    _id: row._id,
    owner: { id: row.owner_id, name: owner?.full_name ?? "Unknown user", role: owner?.role ?? null },
    created_at: row.created_at,
    status: row.status,
    base: parseJson(row.base_json),
    changes: parseJson(row.changes_json),
  };
}

const router = Router();

// GET /api/sync-conflicts/record/:resource/:id
// The record as it is on the server NOW, and every offline edit still waiting on it.
router.get(
  "/record/:resource/:id",
  requireAuth,
  requireRole(...CLINICAL_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const model = RESOURCES[String(req.params.resource)];
    if (!model || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const doc = await model.findById(req.params.id);
    if (!doc || (doc.isArchived && !ADMIN_ONLY.includes(req.user!.role)) || !(await isInScope(model.modelName, req, doc))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await SyncConflict.find({ resource: model.modelName, record_id: doc._id, status: "pending" }).sort({ created_at: 1 });
    res.json({ current: decryptForResponse(doc), candidates: await Promise.all(rows.map(present)) });
  }),
);

// POST /api/sync-conflicts/:id/resolve   { action: "apply" | "discard" }
//   apply   writes this offline edit onto the record; every OTHER pending edit
//           for that record is superseded (one version becomes the record).
//   discard drops only this edit, so the server version stands.
router.post(
  "/:id/resolve",
  requireAuth,
  requireRole(...CLINICAL_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const action = req.body?.action;
    if (!mongoose.isValidObjectId(req.params.id) || (action !== "apply" && action !== "discard")) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const row = await SyncConflict.findById(req.params.id);
    const model = row ? RESOURCES[row.resource] : undefined;
    if (!row || !model) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Already decided (here or by someone else): say so, so the device can drop
    // its copy instead of waiting on a conflict that no longer exists.
    if (row.status !== "pending") {
      res.status(409).json({ error: "This conflict was already resolved.", status: row.status });
      return;
    }
    const doc = await model.findById(row.record_id);
    if (!doc || (doc.isArchived && !ADMIN_ONLY.includes(req.user!.role)) || !(await isInScope(model.modelName, req, doc))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const now = new Date();
    const recordId = String(doc._id);

    if (action === "apply") {
      // Same path as a normal edit: load, assign, save(), never findByIdAndUpdate
      // (CLAUDE.md, DATA ENCRYPTION), so the encrypted fields are written correctly.
      Object.assign(doc, sanitizeBody(parseJson(row.changes_json)));
      await doc.save();
      await SyncConflict.updateMany(
        { resource: row.resource, record_id: row.record_id, status: "pending", _id: { $ne: row._id } },
        { status: "discarded", resolved_by: req.user!.id, resolved_at: now },
      );
      await SyncConflict.updateOne({ _id: row._id }, { status: "applied", resolved_by: req.user!.id, resolved_at: now });
      await logAudit(req.user!.id, `Resolved a ${model.modelName} conflict: kept the offline edit`, recordId, model.modelName);
      res.json({ status: "applied", record: decryptForResponse(doc) });
      return;
    }

    await SyncConflict.updateOne({ _id: row._id }, { status: "discarded", resolved_by: req.user!.id, resolved_at: now });
    await logAudit(req.user!.id, `Resolved a ${model.modelName} conflict: kept the server version`, recordId, model.modelName);
    res.json({ status: "discarded" });
  }),
);

export default router;
