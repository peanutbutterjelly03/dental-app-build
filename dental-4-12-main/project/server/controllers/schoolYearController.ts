import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { School, Student, StudentIptr, User, SchoolYearRollover } from "../models/index.js";
import { comparePassword } from "../utils/password.js";
import { logAudit } from "../utils/auditLog.js";
import { userSchools } from "../utils/schoolScope.js";
import { schoolYearLabel, nextSchoolYear } from "../../shared/schoolYear.js";
import {
  plannedStartProblem,
  rolloverStatus,
  canRequestEarlyStart,
  isLaterSchoolYear,
  startLockedReason,
} from "../../shared/schoolYearRollover.js";

// ─── Starting a school year ─────────────────────────────────────────────────
// 2026-10-01 (user's rules for the Update School Year page):
//   • Only the SYSTEM ADMIN starts a new school year, for EVERY school at once.
//   • A dentist or dental aide may ask, ONCE A YEAR, for their own school to
//     start early; the System Admin approves (only that school's records are
//     cleared) or declines.
//   • The System Admin may set, ahead of time, the date the next year begins —
//     for the NEXT year only. Changing it needs the admin's password; so does
//     starting every school (both are once-a-year, high-stakes actions).
//   • Until a school has started, nobody but the System Admin can create that
//     year's STUDENT_IPTR (guardNextYearIptr).
//
// "Starting" is the same operation the old per-school button ran in the browser,
// moved here so the rule cannot be walked around: write each student's OUTGOING
// grade/section to their STUDENT_IPTR for the year just ending (left alone when
// that year's IPTR already exists, because it already carries the truth), then
// clear STUDENT.grade_level/section. It is idempotent: a student already
// cleared is not touched, so re-running after a partial failure is safe.
//
// ⚠ "Current year" is `schoolYearLabel()` — the app's own convention, which
// buckets May into the year about to begin. The page and the guard both use it,
// so they always agree with the rest of the app (intake writes the same label).

type Id = mongoose.Types.ObjectId | string;

interface RolloverDoc {
  _id: Id;
  school_year: string;
  school_id?: Id | null;
  status: string;
  planned_start?: Date | null;
  start_kind?: string | null;
  requested_by?: Id | null;
  requested_at?: Date | null;
  decided_at?: Date | null;
  started_at?: Date | null;
  updated_at?: Date | null;
}

const years = () => {
  const current = schoolYearLabel();
  return { current, next: nextSchoolYear(current) };
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Checks `req.body.password` against the signed-in user. Answers the request
 *  itself on failure and returns false. */
async function passwordConfirmed(req: Request, res: Response): Promise<boolean> {
  const password = (req.body as { password?: unknown } | undefined)?.password;
  if (typeof password !== "string" || !password) {
    res.status(400).json({ error: "Enter your password to continue." });
    return false;
  }
  const user = await User.findById(req.user!.id).select("+password_hash");
  if (!user || !(await comparePassword(password, user.password_hash))) {
    res.status(401).json({ error: "Incorrect password" });
    return false;
  }
  return true;
}

/** Runs the start for ONE school and records it. Returns how many students were cleared. */
async function startSchool(
  schoolId: Id,
  kind: "all" | "early",
  userId: string,
  current: string,
  next: string,
): Promise<number> {
  const assigned = await Student.find({
    school_id: schoolId,
    isArchived: false,
    $or: [{ grade_level: { $nin: ["", null] } }, { section: { $nin: ["", null] } }],
  })
    .select("_id grade_level section")
    .lean<{ _id: Id; grade_level?: string | null; section?: string | null }[]>();
  // ⚠ A student who ALREADY has a record for the year being started is already in
  // it (a school that rolled over under the old per-school button, or had students
  // assigned early). Their grade is next year's, not last year's: clearing it
  // would undo real work. Only students still carrying the OUTGOING year are cleared.
  const alreadyInNext = new Set(
    (
      await StudentIptr.find({ student_id: { $in: assigned.map((a) => a._id) }, school_year: next, isArchived: false })
        .select("student_id")
        .lean<{ student_id: Id }[]>()
    ).map((i) => String(i.student_id)),
  );
  const carrying = assigned.filter((a) => !alreadyInNext.has(String(a._id)));

  if (carrying.length > 0) {
    const ids = carrying.map((s) => s._id);
    const haveIptr = new Set(
      (
        await StudentIptr.find({ student_id: { $in: ids }, school_year: current, isArchived: false })
          .select("student_id")
          .lean<{ student_id: Id }[]>()
      ).map((i) => String(i.student_id)),
    );
    const missing = carrying
      .filter((s) => !haveIptr.has(String(s._id)))
      .map((s) => ({
        student_id: s._id,
        school_year: current,
        grade_level: s.grade_level || null,
        section: s.section || null,
      }));
    if (missing.length > 0) await StudentIptr.insertMany(missing, { ordered: false });
    // Only unencrypted columns are written, so the encryption plugin has nothing to act on.
    await Student.updateMany({ _id: { $in: ids } }, { $set: { grade_level: "", section: "" } });
  }

  const now = new Date();
  await SchoolYearRollover.findOneAndUpdate(
    { school_year: next, school_id: schoolId },
    { $set: { status: "started", start_kind: kind, started_by: userId, started_at: now, isArchived: false } },
    { upsert: true },
  );
  return carrying.length;
}

/** GET /school-year/status — everything the page needs, scoped to the caller. */
export async function getSchoolYearStatus(req: Request, res: Response) {
  const { current, next } = years();
  const scoped = userSchools(req);
  const schools = await School.find({ isArchived: false, ...(scoped ? { _id: { $in: scoped } } : {}) })
    .select("school_name")
    .sort({ school_name: 1 })
    .lean<{ _id: Id; school_name: string }[]>();

  const rows = await SchoolYearRollover.find({ school_year: next, isArchived: false }).lean<RolloverDoc[]>();
  const plan = rows.find((r) => !r.school_id) ?? null;
  const bySchool = new Map(rows.filter((r) => r.school_id).map((r) => [String(r.school_id), r]));

  // `assigned` = students the start would clear: still carrying a grade or section
  // AND without a record for the year being started (see startSchool).
  const students = await Student.find({ isArchived: false, school_id: { $in: schools.map((s) => s._id) } })
    .select("school_id grade_level section")
    .lean<{ _id: Id; school_id: Id; grade_level?: string | null; section?: string | null }[]>();
  const inNext = new Set(
    (
      await StudentIptr.find({ school_year: next, isArchived: false }).select("student_id").lean<{ student_id: Id }[]>()
    ).map((i) => String(i.student_id)),
  );
  const countOf = new Map<string, { total: number; assigned: number }>();
  for (const p of students) {
    const key = String(p.school_id);
    const c = countOf.get(key) ?? { total: 0, assigned: 0 };
    c.total += 1;
    if ((p.grade_level || p.section) && !inNext.has(String(p._id))) c.assigned += 1;
    countOf.set(key, c);
  }

  const requesterIds = [...new Set(rows.map((r) => r.requested_by).filter(Boolean).map(String))];
  const requesters = requesterIds.length
    ? await User.find({ _id: { $in: requesterIds } }).select("full_name").lean<{ _id: Id; full_name: string }[]>()
    : [];
  const requesterName = new Map(requesters.map((u) => [String(u._id), u.full_name]));

  res.json({
    currentYear: current,
    nextYear: next,
    plannedStart: plan?.planned_start ? ymd(new Date(plan.planned_start)) : null,
    schools: schools.map((s) => {
      const row = bySchool.get(String(s._id)) ?? null;
      const c = countOf.get(String(s._id));
      return {
        id: String(s._id),
        name: s.school_name,
        students: c?.total ?? 0,
        assigned: c?.assigned ?? 0,
        status: rolloverStatus(row),
        startKind: row?.start_kind ?? null,
        requestId: row && row.status === "requested" ? String(row._id) : null,
        requestedBy: row?.requested_by ? requesterName.get(String(row.requested_by)) ?? null : null,
        requestedAt: row?.requested_at ? new Date(row.requested_at).toISOString() : null,
        decidedAt: row?.decided_at ? new Date(row.decided_at).toISOString() : null,
        startedAt: row?.started_at ? new Date(row.started_at).toISOString() : null,
      };
    }),
  });
}

/** PUT /school-year/plan — System Admin sets the next year's start date. */
export async function setSchoolYearPlan(req: Request, res: Response) {
  const planned = (req.body as { planned_start?: unknown }).planned_start;
  const problem = plannedStartProblem(planned);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (!(await passwordConfirmed(req, res))) return;

  const { next } = years();
  const [y, m, d] = (planned as string).split("-").map(Number);
  const row = await SchoolYearRollover.findOneAndUpdate(
    { school_year: next, school_id: null },
    { $set: { planned_start: new Date(y, m - 1, d), status: "planned", isArchived: false } },
    { upsert: true, new: true },
  );
  void logAudit(req.user!.id, `Set ${next} start date to ${planned}`, String(row._id), "SchoolYearRollover");
  res.json({ nextYear: next, plannedStart: planned });
}

/** POST /school-year/start-all — System Admin starts the next year for EVERY school. */
export async function startAllSchools(req: Request, res: Response) {
  const { current, next } = years();
  const locked = startLockedReason(next);
  if (locked) {
    res.status(409).json({ error: locked });
    return;
  }
  if (!(await passwordConfirmed(req, res))) return;

  const schools = await School.find({ isArchived: false }).select("school_name").lean<{ _id: Id; school_name: string }[]>();
  const started = await SchoolYearRollover.find({ school_year: next, status: "started", isArchived: false })
    .select("school_id")
    .lean<{ school_id: Id }[]>();
  const done = new Set(started.map((r) => String(r.school_id)));

  let schoolsStarted = 0;
  let studentsCleared = 0;
  for (const s of schools) {
    if (done.has(String(s._id))) continue;
    studentsCleared += await startSchool(s._id, "all", req.user!.id, current, next);
    schoolsStarted += 1;
  }
  void logAudit(req.user!.id, `Started ${next} for all schools (${studentsCleared} students)`, String(req.user!.id), "SchoolYearRollover");
  res.json({ nextYear: next, schoolsStarted, studentsCleared, alreadyStarted: schools.length - schoolsStarted });
}

/** POST /school-year/request — a dentist or aide asks for THEIR school to start early. Once a year. */
export async function requestEarlyStart(req: Request, res: Response) {
  const schoolId = (req.body as { school_id?: unknown }).school_id;
  if (typeof schoolId !== "string" || !mongoose.isValidObjectId(schoolId)) {
    res.status(400).json({ error: "school_id is required" });
    return;
  }
  const scoped = userSchools(req);
  if (scoped && !scoped.includes(schoolId)) {
    res.status(403).json({ error: "You can only ask for your own school." });
    return;
  }
  const school = await School.findOne({ _id: schoolId, isArchived: false }).select("school_name").lean<{ school_name: string } | null>();
  if (!school) {
    res.status(404).json({ error: "School not found" });
    return;
  }
  const { next } = years();
  const existing = await SchoolYearRollover.findOne({ school_year: next, school_id: schoolId, isArchived: false })
    .select("status")
    .lean<{ status: string } | null>();
  if (!canRequestEarlyStart(rolloverStatus(existing))) {
    res.status(409).json({
      error: existing?.status === "started"
        ? `${next} has already started for this school.`
        : `This school has already used its one request for ${next}.`,
    });
    return;
  }
  const row = await SchoolYearRollover.create({
    school_year: next,
    school_id: schoolId,
    status: "requested",
    requested_by: req.user!.id,
    requested_at: new Date(),
  });
  void logAudit(req.user!.id, `Asked to start ${next} early at ${school.school_name}`, String(row._id), "SchoolYearRollover");
  res.status(201).json({ nextYear: next, status: "requested" });
}

async function openRequest(req: Request, res: Response) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  const row = await SchoolYearRollover.findOne({ _id: id, school_id: { $ne: null }, isArchived: false });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (row.status !== "requested") {
    res.status(409).json({ error: "This request has already been answered." });
    return null;
  }
  return row;
}

/** POST /school-year/requests/:id/approve — System Admin: start THIS school only. */
export async function approveEarlyStart(req: Request, res: Response) {
  const row = await openRequest(req, res);
  if (!row) return;
  const locked = startLockedReason(row.school_year);
  if (locked) {
    res.status(409).json({ error: locked });
    return;
  }
  const { current } = years();
  const cleared = await startSchool(row.school_id as Id, "early", req.user!.id, current, row.school_year);
  await SchoolYearRollover.updateOne({ _id: row._id }, { $set: { decided_by: req.user!.id, decided_at: new Date() } });
  void logAudit(req.user!.id, `Approved early start of ${row.school_year} (${cleared} students)`, String(row._id), "SchoolYearRollover");
  res.json({ status: "started", studentsCleared: cleared });
}

/** POST /school-year/requests/:id/decline — System Admin says no. The school's one request is spent. */
export async function declineEarlyStart(req: Request, res: Response) {
  const row = await openRequest(req, res);
  if (!row) return;
  await SchoolYearRollover.updateOne(
    { _id: row._id },
    { $set: { status: "declined", decided_by: req.user!.id, decided_at: new Date() } },
  );
  void logAudit(req.user!.id, `Declined early start of ${row.school_year}`, String(row._id), "SchoolYearRollover");
  res.json({ status: "declined" });
}

/**
 * Blocks POST /student-iptrs for a school year that has not started at the
 * student's school, for everyone but the System Admin. Without this the page's
 * lock would be a cosmetic: the Add Year menu and the offline queue post
 * straight to the API.
 */
export async function guardNextYearIptr(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "system_admin") return next();
  const body = (req.body ?? {}) as { school_year?: unknown; student_id?: unknown };
  if (typeof body.school_year !== "string" || !isLaterSchoolYear(body.school_year, schoolYearLabel())) return next();
  if (typeof body.student_id !== "string" || !mongoose.isValidObjectId(body.student_id)) return next();
  const student = await Student.findById(body.student_id).select("school_id").lean<{ school_id: Id } | null>();
  if (!student) return next();
  const started = await SchoolYearRollover.exists({
    school_year: body.school_year,
    school_id: student.school_id,
    status: "started",
    isArchived: false,
  });
  if (started) return next();
  res.status(403).json({
    error: `${body.school_year} has not started for this school. Only the System Admin can start it, or approve a request to start it early.`,
  });
}

// ─── Notifications ──────────────────────────────────────────────────────────
// Same item shape as the System Admin alerts in routes/index.ts, so the
// Notifications page renders them without a second code path. Derived from the
// rollover rows (nothing is stored twice); "recent" is the last 30 days.
export interface SchoolYearNotifItem {
  id: string;
  tier: "needs-action" | "recent-activity" | "awaiting-review";
  kind: "school";
  before: string;
  bold: string;
  after: string;
  linkTo: string;
  linkLabel: string;
  at: string | null;
}

const LINK = { linkTo: "/students/update-school-year", linkLabel: "Go to Update School Year" } as const;
const longDate = (d: Date) => d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

export async function buildSchoolYearNotifications(req: Request): Promise<SchoolYearNotifItem[]> {
  const role = req.user?.role;
  const isAdmin = role === "system_admin";
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const scoped = userSchools(req);

  const rows = await SchoolYearRollover.find({
    isArchived: false,
    $or: [{ status: "requested" }, { updated_at: { $gte: since } }],
  }).lean<RolloverDoc[]>();
  if (rows.length === 0) return [];

  const [schools, users] = await Promise.all([
    School.find({ _id: { $in: rows.map((r) => r.school_id).filter(Boolean) } }).select("school_name").lean<{ _id: Id; school_name: string }[]>(),
    User.find({ _id: { $in: rows.map((r) => r.requested_by).filter(Boolean) } }).select("full_name").lean<{ _id: Id; full_name: string }[]>(),
  ]);
  const schoolName = new Map(schools.map((s) => [String(s._id), s.school_name]));
  const userName = new Map(users.map((u) => [String(u._id), u.full_name]));
  const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
  const items: SchoolYearNotifItem[] = [];

  for (const r of rows) {
    const sid = r.school_id ? String(r.school_id) : null;
    const name = sid ? schoolName.get(sid) ?? "a school" : "";

    if (isAdmin) {
      if (r.status === "requested" && sid) {
        items.push({
          id: `sy-request-${r._id}`, tier: "needs-action", kind: "school", before: "",
          bold: userName.get(String(r.requested_by)) ?? "A staff member",
          after: ` asked to start ${r.school_year} early for ${name}.`,
          ...LINK, at: iso(r.requested_at),
        });
      }
      continue;
    }

    // Dentist / dental aide: only their own schools, plus the shared plan.
    if (sid && scoped && !scoped.includes(sid)) continue;
    if (!sid) {
      if (r.planned_start && r.updated_at && new Date(r.updated_at) >= since) {
        items.push({
          id: `sy-plan-${r._id}-${ymd(new Date(r.planned_start))}`, tier: "recent-activity", kind: "school",
          before: "The System Admin set ", bold: r.school_year,
          after: ` to begin on ${longDate(new Date(r.planned_start))}.`, ...LINK, at: iso(r.updated_at),
        });
      }
      continue;
    }
    if (r.status === "started") {
      const early = r.start_kind === "early";
      items.push({
        id: `sy-started-${r._id}`, tier: "recent-activity", kind: "school",
        before: early ? "The System Admin approved your request. " : "The System Admin started ",
        bold: r.school_year,
        after: early ? ` has started for ${name}. You can now move students up.` : ` for ${name}. You can now move students up.`,
        ...LINK, at: iso(r.started_at),
      });
    } else if (r.status === "declined") {
      items.push({
        id: `sy-declined-${r._id}`, tier: "recent-activity", kind: "school",
        before: "The System Admin declined the early start request for ", bold: r.school_year,
        after: ` at ${name}. It starts for every school on the planned date.`, ...LINK, at: iso(r.decided_at),
      });
    }
  }
  return items;
}
