import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { School, User } from "../models/index.js";

// ─── One dentist and one dental aide per school ──────────────────────────────
// A school can have a single dentist and a single dental aide. A dentist or an
// aide may cover several schools. The rule lives here, on the API, so the School
// form, User Management, a role change and a restore all obey the same check;
// checking only in a screen lets another screen walk around it.
//
// ⚠ An account with an EMPTY school_ids covers EVERY school (see User.ts). It
// is not counted against any school here, because "empty" names no school to
// compare, and it is never blocked. Accounts that already break the rule are
// left alone: this only judges the save in front of it.

const LABEL: Record<string, string> = { dentist: "dentist", dental_aide: "dental aide" };

export async function enforceOneStaffPerSchool(req: Request, res: Response, next: NextFunction) {
  const body = (req.body ?? {}) as { role?: unknown; school_ids?: unknown };
  const id = req.params.id as string | undefined;

  // The values as they will be after this save: the body wins, the stored
  // record fills whatever the body leaves out (PUT is partial).
  let role = typeof body.role === "string" ? body.role : undefined;
  let schoolIds: string[] | undefined = Array.isArray(body.school_ids) ? body.school_ids.map(String) : undefined;
  if (id) {
    if (!mongoose.isValidObjectId(id)) { next(); return; }
    const stored = await User.findById(id).select("role school_ids").lean<{ role: string; school_ids?: unknown[] }>();
    if (!stored) { next(); return; }
    role ??= stored.role;
    schoolIds ??= (stored.school_ids ?? []).map(String);
  }

  if (!role || !LABEL[role] || !schoolIds || schoolIds.length === 0) { next(); return; }
  if (!schoolIds.every((s) => mongoose.isValidObjectId(s))) { next(); return; }

  const others = await User.find({
    ...(id ? { _id: { $ne: id } } : {}),
    role,
    isArchived: { $ne: true },
    school_ids: { $in: schoolIds },
  }).select("full_name school_ids").lean<{ full_name: string; school_ids: unknown[] }[]>();
  if (others.length === 0) { next(); return; }

  const taken = new Set(schoolIds);
  const names = new Map(
    (await School.find({ _id: { $in: schoolIds } }).select("school_name").lean<{ _id: unknown; school_name: string }[]>())
      .map((s) => [String(s._id), s.school_name]),
  );
  const clashes: string[] = [];
  for (const other of others) {
    for (const sid of other.school_ids.map(String)) {
      if (taken.has(sid)) clashes.push(`${names.get(sid) ?? "That school"} already has a ${LABEL[role]}: ${other.full_name}.`);
    }
  }
  res.status(409).json({ error: clashes.join(" ") });
}
