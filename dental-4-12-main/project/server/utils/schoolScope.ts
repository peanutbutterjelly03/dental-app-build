import type { Request } from "express";
import mongoose from "mongoose";
import {
  Student,
  StudentIptr,
  DentalChart,
  PreventiveCareRecord,
} from "../models/index.js";

// Sprint 101 — server-side school scoping.
//
// Before this, `school_ids` rode in the JWT but NOTHING read it: the only
// school filtering came from `req.query.school`, i.e. whatever the client
// asked for. A school_admin pinned to one school received all three schools'
// students from the API; the switcher was a display filter, not a boundary.
//
// EMPTY `school_ids` MEANS ALL SCHOOLS (Sprint 100), so an unscoped user costs
// nothing here — `scopeFilter` returns null and no extra query runs.
//
// Only STUDENT carries a school_id among the clinical models. Everything else
// reaches school through a chain, so scoping a child collection means resolving
// the ids at its own level:
//
//   Student            school_id
//   StudentIptr        student_id  -> Student
//   MedicalHistory     iptr_id     -> StudentIptr -> Student
//   DietarySocialHabits, OralHealthCondition, DentalChart,
//   Treatment, PreventiveCareRecord, Referral   (same, via iptr_id)
//   ToothRecord        chart_id    -> DentalChart -> StudentIptr -> Student
//   RiskStratification preventive_id -> PreventiveCareRecord -> ... -> Student
//   Appointment        student_id  -> Student
//   Dentist, DentalAide, DentistRotation   school_id
//
// ⚠ SCALING, stated rather than hidden: each level materialises an id list and
// the filter becomes an `$in`. At the demo's 26 students that is nothing; at
// the Chapter 1 scale of ~8,000 a scoped user's student list is thousands of
// ObjectIds per request. The durable fix is denormalising `school_id` onto the
// child models, which is a schema change across eight models plus a migration
// and write-path upkeep — deliberately NOT done here. Unscoped users (empty
// school_ids: system_admin, bho_staff, and both clinical staff today) never
// touch this path at all, so the cost lands only where a restriction exists.

/** How a model reaches a school. */
type ScopeRule =
  | { via: "none" }
  | { via: "school_id" }
  | { via: "student_id" }
  | { via: "iptr_id" }
  | { via: "chart_id" }
  | { via: "preventive_id" }
  // A school_id that may be NULL, where null means "every school".
  | { via: "school_id_or_global" };

const RULES: Record<string, ScopeRule> = {
  Student: { via: "school_id" },
  Dentist: { via: "school_id" },
  DentalAide: { via: "school_id" },
  DentistRotation: { via: "school_id" },
  StudentIptr: { via: "student_id" },
  Appointment: { via: "student_id" },
  MedicalHistory: { via: "iptr_id" },
  DietarySocialHabits: { via: "iptr_id" },
  OralHealthCondition: { via: "iptr_id" },
  DentalChart: { via: "iptr_id" },
  Treatment: { via: "iptr_id" },
  Referral: { via: "iptr_id" },
  PreventiveCareRecord: { via: "iptr_id" },
  ToothRecord: { via: "chart_id" },
  RiskStratification: { via: "preventive_id" },
  // ⚠ NOT plain "school_id". A DAY_NOTE with school_id null is a barangay-wide
  // note that EVERY user must see; `{school_id: {$in: [...]}}` excludes null,
  // so a plain rule would silently hide every holiday from scoped users.
  DayNote: { via: "school_id_or_global" },

  // Deliberately unscoped, each for a reason:
  //  School  — every user needs school NAMES to render anything, and the list
  //            itself is not patient data.
  //  User    — already ADMIN_ONLY to read, and a system_admin is unscoped.
  //  AuditTrail — already ADMIN_ONLY to read.
  School: { via: "none" },
  User: { via: "none" },
  AuditTrail: { via: "none" },
};

/** Per-request memo, so a request touching several levels resolves each once. */
interface ScopeCache {
  schoolIds?: string[];
  studentIds?: mongoose.Types.ObjectId[];
  iptrIds?: mongoose.Types.ObjectId[];
  chartIds?: mongoose.Types.ObjectId[];
  preventiveIds?: mongoose.Types.ObjectId[];
}

function cacheFor(req: Request): ScopeCache {
  const r = req as Request & { __schoolScope?: ScopeCache };
  if (!r.__schoolScope) r.__schoolScope = {};
  return r.__schoolScope;
}

async function studentIds(req: Request, schools: string[]) {
  const c = cacheFor(req);
  if (!c.studentIds) {
    const docs = await Student.find({ school_id: { $in: schools } }).select("_id").lean();
    c.studentIds = docs.map((d: any) => d._id);
  }
  return c.studentIds;
}

async function iptrIds(req: Request, schools: string[]) {
  const c = cacheFor(req);
  if (!c.iptrIds) {
    const docs = await StudentIptr.find({ student_id: { $in: await studentIds(req, schools) } }).select("_id").lean();
    c.iptrIds = docs.map((d: any) => d._id);
  }
  return c.iptrIds;
}

async function chartIds(req: Request, schools: string[]) {
  const c = cacheFor(req);
  if (!c.chartIds) {
    const docs = await DentalChart.find({ iptr_id: { $in: await iptrIds(req, schools) } }).select("_id").lean();
    c.chartIds = docs.map((d: any) => d._id);
  }
  return c.chartIds;
}

async function preventiveIds(req: Request, schools: string[]) {
  const c = cacheFor(req);
  if (!c.preventiveIds) {
    const docs = await PreventiveCareRecord.find({ iptr_id: { $in: await iptrIds(req, schools) } }).select("_id").lean();
    c.preventiveIds = docs.map((d: any) => d._id);
  }
  return c.preventiveIds;
}

/** The user's school restriction, or null when they are unrestricted. */
export function userSchools(req: Request): string[] | null {
  const ids = req.user?.school_ids ?? [];
  return ids.length === 0 ? null : ids;
}

/**
 * A filter fragment restricting `modelName` to the requester's schools, or
 * `null` when no restriction applies. Merge it into an existing filter.
 *
 * ⚠ Returns `{ _id: { $in: [] } }`-shaped clauses when a user's schools contain
 * no matching records. That is correct — an empty result, not an unfiltered
 * one. Never "fall back to no filter" on an empty set; that inverts the rule.
 */
export async function scopeFilter(
  modelName: string,
  req: Request,
): Promise<Record<string, unknown> | null> {
  const schools = userSchools(req);
  if (!schools) return null;

  const rule = RULES[modelName];
  // Unknown model: fail CLOSED. A model added later without a rule here must
  // not silently become world-readable — it returns nothing until someone
  // decides how it reaches a school.
  if (!rule) return { _id: { $in: [] } };
  if (rule.via === "none") return null;

  switch (rule.via) {
    case "school_id":
      return { school_id: { $in: schools } };
    case "school_id_or_global":
      return { $or: [{ school_id: { $in: schools } }, { school_id: null }] };
    case "student_id":
      return { student_id: { $in: await studentIds(req, schools) } };
    case "iptr_id":
      return { iptr_id: { $in: await iptrIds(req, schools) } };
    case "chart_id":
      return { chart_id: { $in: await chartIds(req, schools) } };
    case "preventive_id":
      return { preventive_id: { $in: await preventiveIds(req, schools) } };
  }
}

/** True when `doc` is inside the requester's schools. Used on the write and
 *  read-one paths, where filtering a list is not the question being asked. */
export async function isInScope(modelName: string, req: Request, doc: any): Promise<boolean> {
  const clause = await scopeFilter(modelName, req);
  if (!clause) return true;

  // The $or shape (school_id_or_global) has to be read differently: a null
  // school_id is IN scope there, whereas for every other rule a missing key
  // means out of scope.
  if ('$or' in clause) {
    const branches = clause.$or as Array<Record<string, unknown>>;
    return branches.some((b) => {
      const [f, cond] = Object.entries(b)[0] as [string, { $in?: unknown[] } | null];
      const v = doc?.[f];
      if (cond === null) return v === null || v === undefined;
      return v !== undefined && v !== null && (cond.$in ?? []).some((a) => String(a) === String(v));
    });
  }

  const [field, condition] = Object.entries(clause)[0] as [string, { $in: unknown[] }];
  const value = doc?.[field];
  if (value === undefined || value === null) return false;
  return condition.$in.some((allowed) => String(allowed) === String(value));
}
