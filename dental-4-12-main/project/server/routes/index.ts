import { Router } from "express";
import mongoose from "mongoose";
import { getHealth } from "../controllers/healthController.js";
import { validateStudentValues } from "../../shared/studentValidation.js";
import { createUser, resetPassword, sendResetLink, initiateTwofa, confirmTwofa, disableTwofa } from "../controllers/userController.js";
import { createCrudRouter } from "./crudFactory.js";
import authRoutes from "./authRoutes.js";
import predictionRoutes from "./predictionRoutes.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { scopeFilter } from "../utils/schoolScope.js";
import { requireAuth, requireRole, isTestingMode } from "../middleware/auth.js";
import { enforceOneStaffPerSchool } from "../middleware/oneStaffPerSchool.js";
import { ADMIN_ONLY, CLINICAL_WRITE_ROLES, CLINICAL_READ_ROLES, CLINICAL_READ_ROLES_AND_BHO, NAME_BLIND_ROLES } from "../middleware/roleGroups.js";
import { aggregateDohReport } from "../../shared/dohAggregate.js";
import { buildRiskCandidates, filterRiskCandidates, reviewSummary } from "../../shared/riskCandidates.js";
import { buildRpcRows, filterRpcRows } from "../../shared/rpcTracking.js";
import { buildSchoolSummary } from "../../shared/schoolSummary.js";
import { buildFhsisCounts } from "../../shared/fhsis.js";
import { buildReportsPanels } from "../../shared/reportsPanels.js";
import { perToothTreatmentCodes, WHOLE_MOUTH_CODE_TO_PREVENTIVE_FIELD } from "../../shared/treatmentCodes.js";
import { schoolYearLabel } from "../../shared/schoolYear.js";
import { findDuplicateStudents } from "../utils/studentDuplicates.js";
import {
  School,
  User,
  Dentist,
  DentalAide,
  Student,
  StudentIptr,
  MedicalHistory,
  DietarySocialHabits,
  OralHealthCondition,
  DentalChart,
  ToothRecord,
  Treatment,
  PreventiveCareRecord,
  RiskStratification,
  Appointment,
  AuditTrail,
  DentistRotation,
  DayNote,
  Referral,
} from "../models/index.js";

const router = Router();

// Sprint 163 (SEC-03): the School Admin's /stats rows keep everything the
// counts need (sex, grade, birthday, school) and lose every name. Same rule
// `/students` applies through its `redact` option; these routes build their
// rows by hand, so each one blanks the names here.
const isNameBlind = (req: { user?: { role?: string } }) => NAME_BLIND_ROLES.includes(req.user?.role ?? "");
const studentNames = (s: any, blind: boolean) => ({
  last_name: blind ? "" : s.last_name ?? "",
  first_name: blind ? "" : s.first_name ?? "",
  middle_name: blind ? "" : s.middle_name ?? "",
  full_name: blind ? "" : s.full_name ?? "",
});

router.get("/health", getHealth);
// Public, no auth: only whether testing mode is on, so the app can show its
// banner and unlock "View as" (see isTestingMode in middleware/auth.ts).
router.get("/config", (_req, res) => { res.json({ testingMode: isTestingMode() }); });
router.use("/auth", authRoutes);
// Predictive analytics (Sprint 21e) — proxies to the Python ML service;
// dentist + system_admin only, every assessment audit-logged.
router.use("/predictions", predictionRoutes);

// Non-clinical / org-management models — System Admin manages accounts,
// schools, and staff records; everyone authenticated can still read them
// (needed for school-name resolution, dentist pickers, etc.).
router.use("/schools", createCrudRouter(School, { writeRoles: ADMIN_ONLY }));
// Intercepts POST /users before the generic CRUD router so passwords are
// always hashed server-side — the generic router would store a plaintext
// "password" field as-is, and password_hash is stripped from its bodies.
// One dentist and one dental aide per school: checked here so every path that
// can change an account's role or schools (create, edit, restore) obeys it.
router.post("/users", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(enforceOneStaffPerSchool), asyncHandler(createUser));
router.put("/users/:id", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(enforceOneStaffPerSchool));
router.patch("/users/:id/restore", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(enforceOneStaffPerSchool));
// Also intercepted before the generic CRUD router -- password_hash is a
// PROTECTED_FIELD there (can't be set via the generic update), and this
// needs bcrypt hashing the generic router doesn't do.
router.patch("/users/:id/reset-password", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(resetPassword));
router.patch("/users/:id/send-reset", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(sendResetLink));
// 2FA management (admin-only, intercepted like reset-password — the twofa
// fields are PROTECTED_FIELDS in the generic router). Enable is
// confirmation-gated: initiate emails a code, confirm proves the mailbox.
router.post("/users/:id/twofa/initiate", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(initiateTwofa));
router.post("/users/:id/twofa/confirm", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(confirmTwofa));
router.post("/users/:id/twofa/disable", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(disableTwofa));
router.use("/users", createCrudRouter(User, { readRoles: ADMIN_ONLY, writeRoles: ADMIN_ONLY }));
router.use("/dentists", createCrudRouter(Dentist, { writeRoles: ADMIN_ONLY }));
router.use("/dental-aides", createCrudRouter(DentalAide, { writeRoles: ADMIN_ONLY }));

// Lightweight aggregate for the sidebar risk badge (Sprint 23p) — replicates
// useStudents' risk join server-side (student → iptrs → preventive → risk
// stratification, first hit wins) so the badge count always matches the
// dashboard, without the client re-fetching 6 collections on every page.
// Read-only; requireAuth matches the underlying models' read policy.
// Sprint 110 — "has anything changed?" as ONE indexed lookup.
//
// Every write in the app goes through logAudit (crudFactory's create, update,
// archive and restore), so AUDIT_TRAIL is already a complete change log, and
// Sprint 92 indexed it { timestamp: -1 }. That makes this a single indexed
// findOne — cheap enough to poll, where re-running a report costs ten
// collection reads.
//
// The client polls this and only refetches when `at` ADVANCES. So a tick costs
// one tiny request instead of ten heavy ones, and the numbers on screen still
// move within the poll interval of someone else saving.
//
// ⚠ Deliberately NOT scoped by school or model. It answers "did anything
// change", not "what changed" — a global token is correct for that question and
// leaks nothing (a timestamp, no ids, no content). If it ever churns too often
// it can be narrowed by `affected_model`, but narrowing it wrongly would make a
// report go stale silently, which is worse than refetching too eagerly.
router.get("/stats/last-change", requireAuth, asyncHandler(async (_req, res) => {
  const latest = await AuditTrail.findOne({}).sort({ timestamp: -1 }).select("timestamp").lean<{ timestamp: Date } | null>();
  res.json({ at: latest?.timestamp ?? null });
}));

router.get("/stats/high-risk-count", requireAuth, asyncHandler(async (req, res) => {
  const schoolName = typeof req.query.school === "string" ? req.query.school : null;
  let studentFilter: Record<string, unknown> = { isArchived: false };
  if (schoolName) {
    const school = await School.findOne({ school_name: schoolName, isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
    if (!school) { res.json({ count: 0 }); return; }
    studentFilter = { ...studentFilter, school_id: school._id };
  }
  // The ?school param is the CLIENT's choice; this is the user's permission
  // (Sprint 101). Both must hold, so they are $and-ed rather than spread —
  // spreading let the scope OVERWRITE the requested school_id, which returned
  // the user's own school's number under another school's name. Disjoint sets
  // now correctly yield nothing.
  const scope = await scopeFilter("Student", req);
  if (scope) studentFilter = { $and: [studentFilter, scope] };
  const [students, iptrs, preventives, risks] = await Promise.all([
    Student.find(studentFilter).select("_id").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("_id iptr_id").lean(),
    // VALIDATED only (2026-10-01): suggestions are now stored unvalidated, and
    // an unreviewed machine suggestion must never count as a high-risk pupil.
    RiskStratification.find({ isArchived: false, validated_by_dentist: true }).select("preventive_id risk_level").lean(),
  ]);
  const preventiveIptrById = new Map(preventives.map((p) => [String(p._id), String(p.iptr_id)]));
  const riskByIptr = new Map<string, string>();
  for (const r of risks) {
    const iptrId = preventiveIptrById.get(String(r.preventive_id));
    if (iptrId) riskByIptr.set(iptrId, String(r.risk_level));
  }
  const iptrsByStudent = new Map<string, string[]>();
  for (const i of iptrs) {
    const list = iptrsByStudent.get(String(i.student_id)) ?? [];
    list.push(String(i._id));
    iptrsByStudent.set(String(i.student_id), list);
  }
  let count = 0;
  for (const s of students) {
    const level = (iptrsByStudent.get(String(s._id)) ?? [])
      .map((id) => riskByIptr.get(id))
      .find(Boolean);
    if (level === "High") count++;
  }
  res.json({ count });
}));

// Notification counts for the sidebar bell (Sprint 97).
//
// ⚠ SERVER-SIDE BECAUSE THE SIDEBAR IS ON EVERY SCREEN. The three sources live
// in `useRPCTracking` (six whole collections) and `useAppointments`; mounting
// those in the sidebar would multiply the app's largest reads across every
// page. This joins the same data once and returns three integers.
//
// ⚠ COUNTS ONLY, AND NOTHING IS INVENTED. There is no NOTIFICATION model, no
// read/unread state and no per-item text — those would need a schema change and
// a decision about persistence. Each count links to the screen that already
// shows the detail, so the bell points at real records rather than paraphrasing
// them (CLAUDE.md: a control that appears to work must work).
// ── System Admin notifications ───────────────────────────────────────────────
// What a System Admin is actually responsible for: account health, changes to
// schools and student data, and what has been archived. Everything is computed
// from real rows (accounts, schools, the audit trail); nothing is invented, and
// clinical reminders (appointments, charts, treatment, RPC, risk, reports) are
// deliberately left out. Built server-side so the sidebar badge and the page
// always agree.
type AdminNotifItem = {
  id: string;
  tier: "needs-action" | "recent-activity" | "awaiting-review";
  kind: "students" | "school" | "archive" | "account" | "security" | "housekeeping";
  before: string;
  bold: string;
  after: string;
  linkTo: string;
  linkLabel: string;
  at: string | null;
};

async function buildAdminNotifications(): Promise<{ items: AdminNotifItem[] }> {
  const items: AdminNotifItem[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recent, users, schools] = await Promise.all([
    AuditTrail.find({ timestamp: { $gte: since } }).sort({ timestamp: -1 })
      .select("user_id action timestamp affected_record_id affected_model").lean<{ _id: unknown; user_id: unknown; action: string; timestamp: Date; affected_record_id: unknown; affected_model: string }[]>(),
    User.find({}).select("full_name last_login twofa_enabled isArchived").lean<{ _id: unknown; full_name: string; last_login: Date | null; twofa_enabled?: boolean; isArchived?: boolean }[]>(),
    School.find({}).select("school_name isArchived").lean<{ _id: unknown; school_name: string; isArchived?: boolean }[]>(),
  ]);
  const userName = new Map(users.map((u) => [String(u._id), u.full_name]));
  const schoolName = new Map(schools.map((s) => [String(s._id), s.school_name]));
  const latest = (list: { timestamp: Date }[]) => (list[0] ? new Date(list[0].timestamp).toISOString() : null);
  const starts = (e: { action: string }, ...verbs: string[]) => verbs.some((v) => e.action === v || e.action.startsWith(`${v} `));

  // Needs action: account and school state that exists right now.
  const active = users.filter((u) => !u.isArchived);
  const neverIn = active.filter((u) => !u.last_login);
  if (neverIn.length) {
    const names = neverIn.slice(0, 3).map((u) => u.full_name).join(", ");
    items.push({
      id: `never-signed-in-${neverIn.length}`, tier: "needs-action", kind: "security",
      before: "", bold: `${neverIn.length} ${plural(neverIn.length, "account")}`,
      after: ` ${neverIn.length === 1 ? "has" : "have"} never signed in: ${names}${neverIn.length > 3 ? ` and ${neverIn.length - 3} more` : ""}.`,
      linkTo: "/accounts", linkLabel: "Go to User Management", at: null,
    });
  }

  // Recent activity: the last 7 days of the audit trail.
  const studentsAdded = recent.filter((e) => starts(e, "Created") && e.affected_model === "Student");
  if (studentsAdded.length) {
    items.push({
      id: `students-added-${studentsAdded.length}`, tier: "recent-activity", kind: "students",
      before: "", bold: `${studentsAdded.length} new ${plural(studentsAdded.length, "student")}`,
      after: ` ${studentsAdded.length === 1 ? "was" : "were"} added in the last 7 days.`,
      linkTo: "/patients", linkLabel: "Go to Students", at: latest(studentsAdded),
    });
  }
  for (const e of recent.filter((r) => r.affected_model === "School").slice(0, 10)) {
    const verb = e.action.startsWith("Created") ? "added" : e.action.startsWith("Archived") ? "archived" : e.action.startsWith("Restored") ? "restored" : "updated";
    const name = schoolName.get(String(e.affected_record_id)) ?? "a school";
    items.push({
      id: `school-${String(e._id)}`, tier: "recent-activity", kind: "school",
      before: `${userName.get(String(e.user_id)) ?? "Someone"} ${verb} the school `, bold: name, after: ".",
      linkTo: "/schools", linkLabel: "Go to Schools", at: new Date(e.timestamp).toISOString(),
    });
  }
  const newAccounts = recent.filter((e) => e.affected_model === "User" && e.action === "Created User").slice(0, 10);
  for (const e of newAccounts) {
    items.push({
      id: `account-${String(e._id)}`, tier: "recent-activity", kind: "account",
      before: `${userName.get(String(e.user_id)) ?? "Someone"} created a new account for `,
      bold: userName.get(String(e.affected_record_id)) ?? "a user", after: ".",
      linkTo: "/accounts", linkLabel: "Go to User Management", at: new Date(e.timestamp).toISOString(),
    });
  }
  const pwd = recent.filter((e) => e.affected_model === "User" && ["Reset Password", "Sent Password Reset Link", "Reset Password via Email", "Changed Password"].includes(e.action));
  if (pwd.length) {
    items.push({
      id: `password-changes-${pwd.length}`, tier: "recent-activity", kind: "account",
      before: "", bold: `${pwd.length} password ${plural(pwd.length, "reset or change", "resets or changes")}`,
      after: " in the last 7 days.", linkTo: "/audit", linkLabel: "Go to Audit Trail", at: latest(pwd),
    });
  }
  const twofa = recent.filter((e) => e.action === "Enabled 2FA" || e.action === "Disabled 2FA");
  if (twofa.length) {
    items.push({
      id: `twofa-changes-${twofa.length}`, tier: "recent-activity", kind: "security",
      before: "", bold: `${twofa.length} two-factor ${plural(twofa.length, "change")}`,
      after: " in the last 7 days.", linkTo: "/audit", linkLabel: "Go to Audit Trail", at: latest(twofa),
    });
  }
  const archivedRecently = recent.filter((e) => starts(e, "Archived") && e.affected_model !== "School");
  if (archivedRecently.length) {
    items.push({
      id: `archived-recent-${archivedRecently.length}`, tier: "recent-activity", kind: "archive",
      before: "", bold: `${archivedRecently.length} ${plural(archivedRecently.length, "record")}`,
      after: ` ${archivedRecently.length === 1 ? "was" : "were"} archived in the last 7 days.`,
      linkTo: "/audit", linkLabel: "Go to Audit Trail", at: latest(archivedRecently),
    });
  }
  const restoredRecently = recent.filter((e) => starts(e, "Restored") && e.affected_model !== "School");
  if (restoredRecently.length) {
    items.push({
      id: `restored-recent-${restoredRecently.length}`, tier: "recent-activity", kind: "archive",
      before: "", bold: `${restoredRecently.length} ${plural(restoredRecently.length, "record")}`,
      after: ` ${restoredRecently.length === 1 ? "was" : "were"} restored in the last 7 days.`,
      linkTo: "/audit", linkLabel: "Go to Audit Trail", at: latest(restoredRecently),
    });
  }

  // Awaiting review: everything currently sitting in the archive.
  const archivedModels = [
    Student, StudentIptr, MedicalHistory, DietarySocialHabits, OralHealthCondition, DentalChart, ToothRecord, Treatment,
    PreventiveCareRecord, RiskStratification, Appointment, DentistRotation, DayNote, Referral, School, User, Dentist, DentalAide,
  ] as unknown as { countDocuments: (q: object) => Promise<number> }[];
  const archivedTotal = (await Promise.all(archivedModels.map((m) => m.countDocuments({ isArchived: true })))).reduce((a, b) => a + b, 0);
  if (archivedTotal) {
    items.push({
      id: `archive-held-${archivedTotal}`, tier: "awaiting-review", kind: "archive",
      before: "", bold: `${archivedTotal} archived ${plural(archivedTotal, "record")}`,
      after: " currently held. Review them, or restore any that were archived by mistake.",
      linkTo: "/archive", linkLabel: "Go to Archived Records", at: null,
    });
  }

  return { items };
}

router.get("/stats/notifications", requireAuth, asyncHandler(async (req, res) => {
  const EMPTY_RESPONSE = { overdueRpc: 0, appointmentsToday: 0, appointmentsTomorrow: 0, awaitingValidation: 0, consentPending: 0, unmarkedAppointments: [] as unknown[], dayNoteToday: null as string | null };
  // System Admin gets admin alerts instead of the clinical reminders.
  if (req.user?.role === "system_admin") {
    res.json({ ...EMPTY_RESPONSE, admin: await buildAdminNotifications() });
    return;
  }
  const schoolName = typeof req.query.school === "string" ? req.query.school : null;
  let studentFilter: Record<string, unknown> = { isArchived: false };
  let schoolId: unknown = null;
  if (schoolName) {
    const school = await School.findOne({ school_name: schoolName, isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
    if (!school) { res.json(EMPTY_RESPONSE); return; }
    schoolId = school._id;
    studentFilter = { ...studentFilter, school_id: school._id };
  }
  // The ?school param is the CLIENT's choice; this is the user's permission
  // (Sprint 101). Both must hold, so they are $and-ed rather than spread —
  // spreading let the scope OVERWRITE the requested school_id, which returned
  // the user's own school's number under another school's name. Disjoint sets
  // now correctly yield nothing.
  const scope = await scopeFilter("Student", req);
  if (scope) studentFilter = { $and: [studentFilter, scope] };

  // Today in the SERVER's local day. The clinic and the server share a
  // timezone; if that ever stops being true this needs the client's offset,
  // because "today's appointments" is a local-day question, not a UTC one.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const tomorrowEnd = new Date(dayEnd); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  // Bounds how far back "never marked" looks -- an appointment from a year
  // ago that was never marked is a data-cleanup problem, not something a
  // dentist opening today's bell should still be shown. 180 days covers a
  // full school year's worth of scheduling without scanning every row ever
  // created (Appointment has no status other than this one to say "closed").
  const unmarkedWindowStart = new Date(dayStart); unmarkedWindowStart.setDate(unmarkedWindowStart.getDate() - 180);

  const [students, iptrs, preventives, risks, appointments, dayNotes] = await Promise.all([
    Student.find(studentFilter).select("_id").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id school_year consent_status").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("iptr_id visit_number visit_date").lean(),
    RiskStratification.find({ isArchived: false }).select("preventive_id risk_level validated_by_dentist").lean(),
    Appointment.find({ isArchived: false, appointment_datetime: { $gte: unmarkedWindowStart, $lt: tomorrowEnd } })
      .select("student_id appointment_datetime status").lean(),
    // ⚠ school_id NULL means "every school" (see DayNote.ts) -- with a school
    // selected, a note applies if it names THAT school OR names none; with no
    // school selected (the "all schools" view), any note for today counts.
    DayNote.find({
      isArchived: false,
      date: { $gte: dayStart, $lt: dayEnd },
      ...(schoolId ? { $or: [{ school_id: null }, { school_id: schoolId }] } : {}),
    }).select("note").sort({ created_at: 1 }).limit(1).lean(),
  ]);

  const inScope = new Set(students.map((s) => String(s._id)));
  const scopedIptrIds = new Set(
    iptrs.filter((i) => inScope.has(String(i.student_id))).map((i) => String(i._id)),
  );

  // ⚠ MIRRORS useRPCTracking's definition EXACTLY: visit 1 recorded, visit 2
  // NOT, and more than RPC_INTERVAL_DAYS (150) elapsed. If that rule ever
  // changes, both places change — a bell that disagrees with the screen it
  // links to is worse than no bell.
  const RPC_INTERVAL_DAYS = 150;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const visits = new Map<string, { first: number | null; hasSecond: boolean }>();
  for (const p of preventives) {
    const key = String(p.iptr_id);
    if (!scopedIptrIds.has(key)) continue;
    const entry = visits.get(key) ?? { first: null, hasSecond: false };
    if (p.visit_number === 2) entry.hasSecond = true;
    if (p.visit_number === 1 && p.visit_date) {
      const t = new Date(p.visit_date as unknown as string).getTime();
      if (!Number.isNaN(t) && (entry.first === null || t < entry.first)) entry.first = t;
    }
    visits.set(key, entry);
  }
  const now = Date.now();
  let overdueRpc = 0;
  for (const { first, hasSecond } of visits.values()) {
    if (hasSecond || first === null) continue;
    if (Math.floor((now - first) / MS_PER_DAY) > RPC_INTERVAL_DAYS) overdueRpc++;
  }

  // ⚠ MIRRORS the Risk Classification "Needs review" tab this links to: pupils
  // (not rows) whose LATEST visit has an unreviewed suggestion, via the same
  // shared reviewSummary. Counting every unvalidated row said 20 on dev while
  // the tab said 10 (2026-10-01): superseded suggestions on older visits.
  // Only in-scope pupils are walked, so the school switcher still applies.
  const risksByPreventive = new Map<string, { risk_level: "High" | "Medium" | "Low"; validated_by_dentist?: boolean }[]>();
  for (const r of risks as any[]) {
    const k = String(r.preventive_id);
    risksByPreventive.set(k, [...(risksByPreventive.get(k) ?? []), r]);
  }
  const latestVisitByStudent = new Map<string, { id: string; t: number }>();
  const studentByIptr = new Map(iptrs.map((i) => [String(i._id), String(i.student_id)]));
  for (const p of preventives as any[]) {
    const iptrId = String(p.iptr_id);
    if (!scopedIptrIds.has(iptrId) || !p.visit_date) continue;
    const sid = studentByIptr.get(iptrId)!;
    const t = new Date(p.visit_date).getTime();
    const cur = latestVisitByStudent.get(sid);
    if (!cur || t > cur.t) latestVisitByStudent.set(sid, { id: String(p._id), t });
  }
  let awaitingValidation = 0;
  for (const { id } of latestVisitByStudent.values()) {
    if (reviewSummary(true, risksByPreventive.get(id) ?? []).status === "needs_review") awaitingValidation++;
  }

  // Consent is collected once per school year (STUDENT_IPTR.consent_status),
  // so a student with an OLD year's consent complete but no decision yet on
  // THIS year's iptr must still count as pending -- the LATEST iptr per
  // student is what decides it, same "latest wins" rule the Students module
  // itself uses for its own consent column.
  const iptrsByStudent = new Map<string, { school_year: string; consent_status: string }[]>();
  for (const i of iptrs) {
    if (!inScope.has(String(i.student_id))) continue;
    const list = iptrsByStudent.get(String(i.student_id)) ?? [];
    list.push({ school_year: String(i.school_year), consent_status: String(i.consent_status) });
    iptrsByStudent.set(String(i.student_id), list);
  }
  let consentPending = 0;
  for (const list of iptrsByStudent.values()) {
    const latest = list.slice().sort((a, b) => b.school_year.localeCompare(a.school_year))[0];
    if (latest?.consent_status === "pending") consentPending++;
  }

  // "Never marked" -- scheduled time has passed with the status still
  // whatever it was created as (Scheduled), never moved to Completed/Missed/
  // etc. Same test the Appointments module's own Missed tab uses
  // (isOverdueUnmarked), so this bell can never disagree with that screen.
  let appointmentsToday = 0;
  let appointmentsTomorrow = 0;
  const unmarkedRaw: { id: string; studentId: string; datetime: Date }[] = [];
  for (const a of appointments) {
    if (!inScope.has(String(a.student_id))) continue;
    const dt = new Date(a.appointment_datetime as unknown as string);
    if (dt >= dayStart && dt < dayEnd) appointmentsToday++;
    else if (dt >= dayEnd && dt < tomorrowEnd) appointmentsTomorrow++;
    else if (dt < dayStart && String(a.status).toLowerCase() === "scheduled") {
      unmarkedRaw.push({ id: String(a._id), studentId: String(a.student_id), datetime: dt });
    }
  }
  unmarkedRaw.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());

  const unmarkedStudents = unmarkedRaw.length
    ? await Student.find({ _id: { $in: unmarkedRaw.map((a) => a.studentId) }, isArchived: false })
    : [];
  const nameById = new Map(unmarkedStudents.map((s: any) => {
    const last = (s.last_name ?? "").trim();
    const first = (s.first_name ?? "").trim();
    const name = !last && !first ? (s.full_name ?? "").trim() : !last ? first : !first ? last : `${last}, ${first}`;
    return [String(s._id), name];
  }));
  // Sprint 163 (SEC-03): the "visit not marked" list names pupils and is clinic
  // work; non-clinical roles get counts only, never this list.
  const clinical = CLINICAL_READ_ROLES.includes(req.user?.role ?? "");
  const unmarkedAppointments = unmarkedRaw
    .filter((a) => clinical && nameById.has(a.studentId))
    .map((a) => ({ id: a.id, studentId: a.studentId, studentName: nameById.get(a.studentId)!, datetime: a.datetime.toISOString() }));

  res.json({
    overdueRpc,
    appointmentsToday,
    appointmentsTomorrow,
    awaitingValidation,
    consentPending,
    unmarkedAppointments,
    dayNoteToday: dayNotes[0]?.note ?? null,
  });
}));

// The patient-list row, joined server-side (Sprint 56b). Same join as the
// badge above, one level richer: every screen that shows a student list needs
// name, grade, school, last visit and risk, and useStudents used to build that
// in the browser by downloading SIX whole collections — students, schools,
// IPTRs, dental charts, preventive care records and risk stratifications —
// on every page that mounts it. Eight components do. At the Chapter 1 scale of
// ~8,000 students that is the largest read in the app.
//
// Deliberately returns every student rather than a page: three of the eight
// consumers (Reports, TargetClientList, the dashboard stats) aggregate over the
// whole population, so paging here would break them. The win is payload and
// browser CPU — one slim array instead of six full collections — not a smaller
// result set. Paging the list-shaped consumers is separate, still-open work.
//
// NOTE: `students` is the one query here that cannot use .lean(). The name
// fields are encrypted, and mongoose-field-encryption decrypts in post('init'),
// which only runs for real documents — a lean() or aggregate() read would
// return ciphertext. Everything else is lean because none of it is encrypted.
// The prev/next patient nav on the dental chart needs three fields per student
// — id, display name, school — and nothing else. It used to get them from
// /stats/student-rows via useStudents(), which returns ~13 fields per row and
// joins SIX collections to compute a last-visit date and a risk badge the nav
// never looks at (backlog #39). This reads two collections and projects three
// fields, so it does not grow with the chart/risk data the way the full row
// endpoint does.
//
// Same `scopeFilter` gate as /stats/student-rows — Sprint 101 caught that
// endpoint handing every school's students to a school_admin pinned to one, and
// a new endpoint must not reopen it. `students` cannot use .lean(): the name
// fields are encrypted and mongoose-field-encryption decrypts in post('init'),
// which a lean read never triggers.
// Sprint 138 — the DOH report's counts, computed HERE instead of in the
// browser.
//
// ⚠ WHY: `useDohReportData` downloaded ELEVEN WHOLE COLLECTIONS to draw one
// report. Measured 2026-09-05 against dev — 26 pupils, ~108 KB, i.e. ~4.1 KB
// per pupil per page open, so ~32 MB at the Chapter 1 scale of 8,000 pupils,
// and 60-80 MB once mouths are charted at a realistic 20-32 teeth instead of
// the demo's ~5. The response here is a few KB whatever the roll size.
//
// The joining logic itself was MOVED to `shared/dohAggregate.ts`, not copied:
// two implementations of a DOH return would drift, and the drift would appear
// as two different numbers on a document filed with the City Health Office.
//
// ⚠ SCOPE GATE, same as /stats/student-rows. Sprint 101 caught that endpoint
// handing every school's students to a school_admin pinned to one; a new
// endpoint must not reopen it.
//
// ⚠ `.lean()` IS SAFE HERE and would not be on a name field: this reads only
// sex, birthday, school_id and ids, none of which are encrypted. A lean read of
// an encrypted field returns `<iv>:<ciphertext>` silently (Sprint 118), so if
// this endpoint ever needs a name, it must drop lean for that query.
// Sprint 139 — the Risk Classification candidate list, joined HERE instead of
// in the browser. It used to pull NINE whole collections to draw one list.
//
// ⚠ UNLIKE /stats/doh-report THIS STILL RETURNS ONE ROW PER PUPIL, so the
// response does grow with the roll — a row is ~13 numbers and a short history
// rather than nine collections of documents. Paging it is separate, still-open
// work (#24); saying so is better than implying the problem is finished.
//
// ⚠ `Student.find()` HAS NO .lean() AND NO .select(). This endpoint needs the
// pupil's NAME, and mongoose-field-encryption decrypts in post('init') using
// the `__enc_*` markers stored beside each value: a lean read never triggers
// it, and a projection that omits the markers leaves the plugin nothing to
// decrypt. Either one returns `<iv>:<ciphertext>` — silently, with a 200
// (Sprint 118). Everything else here is lean because none of it is encrypted.
// Sprint 140 — the RPC Tracking roll-up, joined HERE instead of in the browser
// (six whole collections before). Same `scopeFilter` gate as the other three
// aggregates.
//
// ⚠ Like /stats/risk-candidates and unlike /stats/doh-report, this returns ONE
// ROW PER PUPIL, so it still grows with the roll. Paging is open work (#24).
//
// ⚠ `Student.find()` has no .lean() and no .select(): the row carries the
// pupil's NAME, and either would return `<iv>:<ciphertext>` silently with a
// 200 (Sprint 118).
// Sprint 141 — the per-school summary sheet, tallied HERE instead of in the
// browser (six whole collections before). Like /stats/doh-report the OUTPUT IS
// COUNTS, so this response is flat: it does not grow with the roll.
//
// ⚠ `.lean()` is safe on Student here and would NOT be if this endpoint needed
// a name: it reads only `sex` and `school_id`. A lean read of an encrypted
// field returns `<iv>:<ciphertext>` silently with a 200 (Sprint 118).
// Sprint 142 — the FHSIS monthly counts, tallied HERE instead of in the
// browser (four whole collections before). Output is COUNTS, so the response
// is flat. Same `scopeFilter` gate as the other aggregates.
//
// ⚠ `.lean()` is safe on Student: this reads only sex, birthday and school_id.
// It would NOT be if the form ever needed a name (Sprint 118).
//
// ⚠ The `schools` list is returned to the client as well — the report's own
// school dropdown is populated from it, and it was one of the four whole
// collections this endpoint replaces.
// Sprint 143 — the Reports page's OWN two panels (Treatment Summary and
// Referral Tracking), which fetched five whole collections on top of the five
// report hooks already moved. Last of #24's client half.
//
// ⚠ `Student.find()` has no .lean() and no .select(): the referral rows carry
// the pupil's NAME, and either would return ciphertext silently (Sprint 118).
router.get("/stats/reports-panels", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [students, schools, iptrs, charts, toothRecords, treatments, referrals] = await Promise.all([
    Student.find(studentFilter),
    School.find(active).select("_id school_name").lean(),
    StudentIptr.find(active).select("_id student_id grade_level").lean(),
    DentalChart.find(active).select("_id iptr_id date_charted").lean(),
    ToothRecord.find(active).select("chart_id treatment_code").lean(),
    Treatment.find(active).select("iptr_id date").lean(),
    // ⚠ NOT `.lean()` — REFERRAL.reason is ENCRYPTED and this panel PRINTS it.
    // Lean would hand the Referral Tracking table `<iv>:<ciphertext>` with a
    // 200 and no error, exactly as it did to the DOH allergies row (fixed the
    // same day in 4bd5deb0). Not observable on dev, which holds zero
    // referrals — it would have appeared the first time one was issued.
    Referral.find(active),
  ]);

  const str = (v: unknown) => String(v ?? "");
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  const blind = isNameBlind(req);
  const out = buildReportsPanels({
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      grade_level: str(s.grade_level),
      ...studentNames(s, blind),
    })),
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    iptrs: (iptrs as any[]).map((i) => ({
      _id: str(i._id),
      student_id: str(i.student_id),
      grade_level: i.grade_level ?? null,
    })),
    charts: (charts as any[]).map((c) => ({ _id: str(c._id), iptr_id: str(c.iptr_id), date_charted: iso(c.date_charted) })),
    toothRecords: (toothRecords as any[]).map((t) => ({ chart_id: str(t.chart_id), treatment_code: t.treatment_code ?? null })),
    treatments: (treatments as any[]).map((t) => ({ iptr_id: str(t.iptr_id), date: iso(t.date) })),
    // SEC-33: no referral rows for the School Admin (who was referred where,
    // and why, is a clinical record). The Internal tab also hides the table.
    referrals: (blind ? [] : referrals as any[]).map((r) => ({
      _id: str(r._id),
      iptr_id: str(r.iptr_id),
      referral_type: str(r.referral_type),
      date_issued: iso(r.date_issued),
      facility_name: str(r.facility_name),
      reason: str(r.reason),
      follow_up_date: r.follow_up_date ? iso(r.follow_up_date) : null,
      status: str(r.status),
    })),
    from: typeof req.query.from === "string" && req.query.from ? req.query.from : null,
    to: typeof req.query.to === "string" && req.query.to ? req.query.to : null,
    schoolName: typeof req.query.school === "string" && req.query.school ? req.query.school : null,
  });

  res.json(out);
}));

router.get("/stats/fhsis", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [students, iptrs, pcrs, schools] = await Promise.all([
    Student.find(studentFilter).select("_id school_id sex birthday").lean(),
    StudentIptr.find(active).select("_id student_id").lean(),
    PreventiveCareRecord.find(active).select("iptr_id visit_date visit_number facility_based").lean(),
    School.find(active).lean(),
  ]);

  const str = (v: unknown) => String(v ?? "");
  const out = buildFhsisCounts({
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      birthday: s.birthday ? new Date(s.birthday).toISOString() : "",
    })),
    iptrs: (iptrs as any[]).map((i) => ({ _id: str(i._id), student_id: str(i.student_id) })),
    pcrs: (pcrs as any[]).map((p) => ({
      iptr_id: str(p.iptr_id),
      visit_date: p.visit_date ? new Date(p.visit_date).toISOString() : "",
      visit_number: Number(p.visit_number ?? 0),
      facility_based: p.facility_based ?? null,
    })),
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    month: typeof req.query.month === "string" ? req.query.month : "",
    schoolName: typeof req.query.school === "string" ? req.query.school : "",
  });

  res.json({ ...out, schools });
}));

router.get("/stats/school-summary", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [schools, students, iptrs, orals, charts, toothRecords] = await Promise.all([
    School.find(active).select("_id school_name").lean(),
    Student.find(studentFilter).select("_id school_id sex").lean(),
    StudentIptr.find(active).select("_id student_id school_year").lean(),
    OralHealthCondition.find(active).select("iptr_id gingivitis debris calculus").lean(),
    DentalChart.find(active).select("_id iptr_id").lean(),
    ToothRecord.find(active).select("chart_id condition treatment_code").lean(),
  ]);

  const str = (v: unknown) => String(v ?? "");
  const out = buildSchoolSummary({
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    students: (students as any[]).map((s) => ({ _id: str(s._id), school_id: str(s.school_id), sex: str(s.sex) })),
    iptrs: (iptrs as any[]).map((i) => ({ _id: str(i._id), student_id: str(i.student_id), school_year: str(i.school_year) })),
    orals: (orals as any[]).map((o) => ({
      iptr_id: str(o.iptr_id),
      gingivitis: o.gingivitis,
      debris: o.debris,
      calculus: o.calculus,
    })),
    charts: (charts as any[]).map((c) => ({ _id: str(c._id), iptr_id: str(c.iptr_id) })),
    toothRecords: (toothRecords as any[]).map((t) => ({
      chart_id: str(t.chart_id),
      condition: t.condition ?? null,
      treatment_code: t.treatment_code ?? null,
    })),
    schoolName: typeof req.query.school === "string" && req.query.school ? req.query.school : null,
    schoolYear: typeof req.query.school_year === "string" && req.query.school_year ? req.query.school_year : null,
  });

  res.json(out);
}));

router.get("/stats/rpc-rows", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [students, schools, iptrs, preventives, charts, toothRecords] = await Promise.all([
    Student.find(studentFilter),
    School.find(active).select("_id school_name").lean(),
    StudentIptr.find(active).select("_id student_id school_year").lean(),
    PreventiveCareRecord.find(active)
      .select("_id iptr_id visit_date visit_number facility_based oral_screening oral_prophylaxis fluoride_varnish oral_hygiene_instruction caries_risk")
      .lean(),
    DentalChart.find(active).select("_id iptr_id").lean(),
    ToothRecord.find(active).select("chart_id tooth_number condition treatment_code").lean(),
  ]);

  const str = (v: unknown) => String(v ?? "");
  const blind = isNameBlind(req);
  const rows = buildRpcRows({
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      birthday: s.birthday ? new Date(s.birthday).toISOString() : "",
      grade_level: str(s.grade_level),
      section: str(s.section),
      ...studentNames(s, blind),
    })),
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    iptrs: (iptrs as any[]).map((i) => ({ _id: str(i._id), student_id: str(i.student_id), school_year: str(i.school_year) })),
    preventives: (preventives as any[]).map((p) => ({
      _id: str(p._id),
      iptr_id: str(p.iptr_id),
      visit_date: p.visit_date ? new Date(p.visit_date).toISOString() : "",
      visit_number: Number(p.visit_number ?? 0),
      facility_based: p.facility_based ?? null,
      // Sprint 147 — what was DONE at the visit, not just that it happened.
      oral_screening: p.oral_screening ?? null,
      oral_prophylaxis: p.oral_prophylaxis ?? null,
      fluoride_varnish: p.fluoride_varnish ?? null,
      oral_hygiene_instruction: p.oral_hygiene_instruction ?? null,
      caries_risk: p.caries_risk ?? null,
    })),
    charts: (charts as any[]).map((c) => ({ _id: str(c._id), iptr_id: str(c.iptr_id) })),
    toothRecords: (toothRecords as any[]).map((t) => ({
      chart_id: str(t.chart_id),
      tooth_number: Number(t.tooth_number ?? 0),
      condition: t.condition ?? null,
      treatment_code: t.treatment_code ?? null,
    })),
  });

  // Sprint 146 — filter and PAGE here, the same move Sprint 145 made on the
  // risk list. ⚠ `sectionOptions` and both totals are computed over the
  // population, never the page.
  const page = filterRpcRows(rows, {
    q: typeof req.query.q === "string" ? req.query.q : "",
    school: typeof req.query.school === "string" && req.query.school ? req.query.school : "",
    grade: typeof req.query.grade === "string" ? req.query.grade : "all",
    section: typeof req.query.section === "string" ? req.query.section : "all",
    gender: typeof req.query.gender === "string" ? req.query.gender : "all",
    ageGroup: typeof req.query.age_group === "string" ? req.query.age_group : "all",
    status: typeof req.query.status === "string" ? req.query.status : "outstanding",
    treatment: typeof req.query.treatment === "string" ? req.query.treatment : "all",
    schoolYear: typeof req.query.school_year === "string" ? req.query.school_year : "all",
    sort: typeof req.query.sort === "string" ? req.query.sort : "all",
    limit: Number(req.query.limit) > 0 ? Number(req.query.limit) : 25,
    offset: Number(req.query.offset) > 0 ? Number(req.query.offset) : 0,
  });

  res.json(page);
}));

// Sprint 163 (SEC-03): the risk screens and the chart's Prev/Next nav name
// pupils and carry clinical findings; clinic roles + System Admin only.
router.get("/stats/risk-candidates", requireAuth, requireRole(...CLINICAL_READ_ROLES), asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [students, schools, iptrs, charts, toothRecords, orals, dietaries, preventives, risks] = await Promise.all([
    Student.find(studentFilter),
    School.find(active).select("_id school_name").lean(),
    StudentIptr.find(active).select("_id student_id school_year").lean(),
    DentalChart.find(active).select("_id iptr_id date_charted").lean(),
    ToothRecord.find(active).select("chart_id condition tooth_number").lean(),
    OralHealthCondition.find(active).lean(),
    DietarySocialHabits.find(active).lean(),
    PreventiveCareRecord.find(active).select("_id iptr_id visit_date visit_number").lean(),
    // Not `dentist_notes` (encrypted, and the list never shows it).
    RiskStratification.find(active).select("-dentist_notes").lean(),
  ]);

  const str = (v: unknown) => String(v ?? "");
  const rows = buildRiskCandidates({
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      birthday: s.birthday ? new Date(s.birthday).toISOString() : "",
      grade_level: str(s.grade_level),
      section: str(s.section),
      last_name: s.last_name ?? "",
      first_name: s.first_name ?? "",
      middle_name: s.middle_name ?? "",
      full_name: s.full_name ?? "",
    })),
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    iptrs: (iptrs as any[]).map((i) => ({ _id: str(i._id), student_id: str(i.student_id), school_year: str(i.school_year) })),
    charts: (charts as any[]).map((c) => ({
      _id: str(c._id),
      iptr_id: str(c.iptr_id),
      date_charted: c.date_charted ? new Date(c.date_charted).toISOString() : null,
    })),
    toothRecords: (toothRecords as any[]).map((t) => ({
      chart_id: str(t.chart_id),
      condition: t.condition ?? null,
      tooth_number: typeof t.tooth_number === "number" ? t.tooth_number : null,
    })),
    orals: (orals as any[]).map((o) => ({ ...o, iptr_id: str(o.iptr_id) })),
    dietaries: (dietaries as any[]).map((d) => ({ ...d, iptr_id: str(d.iptr_id) })),
    preventives: (preventives as any[]).map((p) => ({
      _id: str(p._id),
      iptr_id: str(p.iptr_id),
      visit_date: p.visit_date ? new Date(p.visit_date).toISOString() : "",
      visit_number: typeof p.visit_number === "number" ? p.visit_number : null,
    })),
    risks: (risks as any[]).map((r) => ({
      _id: str(r._id),
      preventive_id: str(r.preventive_id),
      risk_level: r.risk_level,
      recommendation: r.recommendation ?? "",
      dmf_score: Number(r.dmf_score ?? 0),
      validated_by_dentist: r.validated_by_dentist ?? false,
      validated_at: r.validated_at ? new Date(r.validated_at).toISOString() : null,
      model_risk_level: r.model_risk_level ?? null,
      model_confidence: typeof r.model_confidence === "number" ? r.model_confidence : null,
    })),
    // Sprint 144 — the LIST carries only the last two assessments per pupil.
    // The badge reads the latest and the trend compares the last two; nothing
    // on the list reads further back. `history` is the one field here that
    // grows with TIME as well as roll size, so leaving it unbounded meant the
    // response grew every school year even if the roll never changed. The
    // detail panel fetches the full history from /stats/risk-history.
    historyLimit: 2,
  });

  // Sprint 145 — filter, sort and PAGE here. Doing any of those on the client
  // is what forced this endpoint to send every pupil (measured 673 B/row, so
  // ~5.4 MB at 8,000). ⚠ The tiles' counts and the dropdown options come back
  // computed over the whole filtered population, never the page.
  const page = filterRiskCandidates(rows, {
    q: typeof req.query.q === "string" ? req.query.q : "",
    studentId: typeof req.query.student_id === "string" ? req.query.student_id : "",
    school: typeof req.query.school === "string" && req.query.school ? req.query.school : "",
    grade: typeof req.query.grade === "string" ? req.query.grade : "all",
    section: typeof req.query.section === "string" ? req.query.section : "all",
    risk: typeof req.query.risk === "string" ? req.query.risk : "all",
    gender: typeof req.query.gender === "string" ? req.query.gender : "all",
    ageGroup: typeof req.query.age_group === "string" ? req.query.age_group : "all",
    sort: req.query.sort === "name" ? "name" : "priority",
    status: (["needs_review", "reviewed", "not_checked", "no_visit"] as const).find((s) => s === req.query.status) ?? "all",
    limit: Number(req.query.limit) > 0 ? Number(req.query.limit) : 50,
    offset: Number(req.query.offset) > 0 ? Number(req.query.offset) : 0,
  });

  res.json(page);
}));

// Sprint 144 — one pupil's FULL assessment history, for the detail panel.
// Deliberately its own endpoint rather than a bigger list row: it is read when
// a dentist opens one pupil, which is once per selection, not once per page.
router.get("/stats/risk-history", requireAuth, requireRole(...CLINICAL_READ_ROLES), asyncHandler(async (req, res) => {
  const studentId = typeof req.query.student_id === "string" ? req.query.student_id : "";
  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ error: "Invalid student_id" });
    return;
  }
  // ⚠ The same school gate as the list. Without it this endpoint would hand a
  // pinned school_admin any pupil's clinical history by id — the exact hole
  // Sprint 101 closed on the read paths.
  const scope = await scopeFilter("Student", req);
  const student = await Student.findOne(
    scope ? { _id: studentId, isArchived: false, ...scope } : { _id: studentId, isArchived: false },
  ).select("_id").lean();
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const active = { isArchived: false };
  const iptrs = await StudentIptr.find({ ...active, student_id: studentId }).select("_id school_year").lean();
  const iptrIds = (iptrs as any[]).map((i) => i._id);
  const preventives = await PreventiveCareRecord.find({ ...active, iptr_id: { $in: iptrIds } })
    .select("_id visit_date")
    .lean();
  // VALIDATED only (2026-10-01): a stored suggestion is not an assessment
  // until the dentist reviews it; the list row carries it as `suggestion`.
  const risks = await RiskStratification.find({
    ...active,
    validated_by_dentist: true,
    preventive_id: { $in: (preventives as any[]).map((p) => p._id) },
  }).select("-dentist_notes").lean();

  // ⚠ TO ISO FIRST. `.lean()` returns `visit_date` as a Date, and
  // `String(date).slice(0, 10)` yields "Sun Aug 09", not "2026-08-09" — the
  // detail panel would then print a different date format from the list for
  // the same assessment. Caught by reading the endpoint's output.
  const visitDateById = new Map(
    (preventives as any[]).map((p) => [String(p._id), p.visit_date ? new Date(p.visit_date).toISOString() : ""]),
  );
  const history = (risks as any[])
    .map((r) => ({
      id: String(r._id),
      riskLevel: r.risk_level,
      recommendation: r.recommendation ?? "",
      dmfScore: Number(r.dmf_score ?? 0),
      validated: r.validated_by_dentist ?? false,
      validatedAt: r.validated_at ? new Date(r.validated_at).toISOString() : null,
      visitDate: String(visitDateById.get(String(r.preventive_id)) ?? "").slice(0, 10),
    }))
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate));

  res.json(history);
}));

router.get("/stats/doh-report", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [schools, students, iptrs, medicals, dietaries, orals, preventives, risks, charts, toothRecords, referrals] =
    await Promise.all([
      School.find(active).select("_id school_name").lean(),
      Student.find(studentFilter).select("_id school_id sex birthday").lean(),
      StudentIptr.find(active).select("_id student_id school_year grade_level").lean(),
      // ⚠ NOT `.lean()` — MEDICAL_HISTORY.allergies is ENCRYPTED, and the DOH
      // return counts it by truthiness. Under `.lean()` every row comes back as
      // `<iv>:<ciphertext>` (the Sprint 118 trap), and the plugin encrypts the
      // empty string too — so EVERY pupil looked like they had an allergy.
      // Measured on dev 2026-09-06: the form printed 26 where the truth was 3.
      // Hydrating decrypts; the other medical fields are plain booleans.
      MedicalHistory.find(active),
      DietarySocialHabits.find(active).lean(),
      OralHealthCondition.find(active).lean(),
      PreventiveCareRecord.find(active).select("_id iptr_id visit_number visit_date facility_based").lean(),
      // VALIDATED only (2026-10-01): these feed FILED DOH figures (DMF counts,
      // orally-fit count). Suggestions are now stored unvalidated; an unreviewed
      // machine suggestion must never reach a form sent to the City Health Office.
      RiskStratification.find({ ...active, validated_by_dentist: true }).select("preventive_id dmf_score dmf_index risk_level").lean(),
      DentalChart.find(active).select("_id iptr_id date_charted preventive_id").lean(),
      ToothRecord.find(active).select("chart_id treatment_code").lean(),
      Referral.find(active).select("iptr_id referral_type").lean(),
    ]);

  const str = (v: unknown) => String(v ?? "");
  // Chart → visit, for the 1st/2nd application ordinal (Sprint 150).
  const visitNumberByPreventive = new Map<string, 1 | 2>(
    (preventives as any[])
      .filter((p) => p.visit_number === 1 || p.visit_number === 2)
      .map((p) => [String(p._id), p.visit_number as 1 | 2]),
  );
  const out = aggregateDohReport({
    schools: (schools as any[]).map((s) => ({ _id: str(s._id), school_name: str(s.school_name) })),
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      birthday: s.birthday ? new Date(s.birthday).toISOString() : "",
    })),
    iptrs: (iptrs as any[]).map((i) => ({
      _id: str(i._id),
      student_id: str(i.student_id),
      school_year: str(i.school_year),
      grade_level: i.grade_level ?? null,
    })),
    medicals: (medicals as any[]).map((m) => ({
      ...(m.toObject ? m.toObject() : m),
      iptr_id: str(m.iptr_id),
      // Decrypted above; trimmed here so "" and " " both read as "no allergy".
      allergies: String(m.allergies ?? "").trim(),
    })),
    dietaries: (dietaries as any[]).map((d) => ({ ...d, iptr_id: str(d.iptr_id) })),
    orals: (orals as any[]).map((o) => ({ ...o, iptr_id: str(o.iptr_id) })),
    preventives: (preventives as any[]).map((p) => ({
      _id: str(p._id),
      iptr_id: str(p.iptr_id),
      visit_number: p.visit_number,
      visit_date: p.visit_date ? new Date(p.visit_date).toISOString() : null,
      facility_based: p.facility_based ?? null,
    })),
    risks: (risks as any[]).map((r) => ({
      preventive_id: str(r.preventive_id),
      dmf_score: Number(r.dmf_score ?? 0),
      dmf_index: str(r.dmf_index),
      risk_level: str(r.risk_level),
    })),
    charts: (charts as any[]).map((c) => ({
      _id: str(c._id),
      iptr_id: str(c.iptr_id),
      date_charted: c.date_charted ? new Date(c.date_charted).toISOString() : "",
      // Sprint 150 — the visit this charting was done at, resolved through
      // `preventive_id`. Null for every chart made before Sprint 149, which is
      // why the aggregate keeps its date-order fallback.
      visit_number: c.preventive_id ? visitNumberByPreventive.get(str(c.preventive_id)) ?? null : null,
    })),
    toothRecords: (toothRecords as any[]).map((t) => ({
      chart_id: str(t.chart_id),
      treatment_code: t.treatment_code ?? null,
    })),
    referrals: (referrals as any[]).map((r) => ({ iptr_id: str(r.iptr_id), referral_type: str(r.referral_type) })),
    schoolYear: typeof req.query.school_year === "string" && req.query.school_year ? req.query.school_year : null,
    schoolName: typeof req.query.school === "string" && req.query.school ? req.query.school : null,
  });

  res.json(out);
}));

router.get("/stats/student-nav", requireAuth, requireRole(...CLINICAL_READ_ROLES), asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const [students, schools] = await Promise.all([
    // ⚠ NO .select() on Student, and no .lean(). mongoose-field-encryption
    // decrypts in post('init') and decides what to decrypt from the `__enc_*`
    // marker fields it stores alongside each encrypted value. A projection that
    // lists only the name fields drops those markers, the plugin sees nothing to
    // decrypt, and the endpoint returns `<iv>:<ciphertext>` instead of a name —
    // silently, with a 200. Caught here by diffing this endpoint against
    // /stats/student-rows; every row differed. Project in JS below instead.
    Student.find(studentFilter),
    School.find({ isArchived: false }).select("_id school_name").lean(),
  ]);
  const schoolNameById = new Map(schools.map((s: any) => [String(s._id), String(s.school_name)]));

  const rows = (students as any[]).map((s) => {
    const last = (s.last_name ?? "").trim();
    const first = (s.first_name ?? "").trim();
    return {
      id: String(s._id),
      // Identical to /stats/student-rows' surnameFirst() fallbacks — the nav
      // sorts on this string, so any drift here reorders prev/next.
      name: !last && !first ? (s.full_name ?? "").trim() : !last ? first : !first ? last : `${last}, ${first}`,
      // The prev/next buttons show the surname alone, matching the sort order.
      lastName: s.last_name ?? "",
      firstName: s.first_name ?? "",
      // Added 2026-09-27 -- the Student Records nav (opened from that
      // module, no ?context=) sorts grade > section > gender > surname >
      // first name, same as PatientList's own table, not plain alphabetical.
      // These three fields are what that comparator needs.
      gender: s.sex,
      grade: s.grade_level,
      section: s.section,
      school: schoolNameById.get(String(s.school_id)) ?? "Unknown School",
    };
  });
  res.json(rows);
}));

// Treatment Records' category cards (user, 2026-09-27). Each of the 10
// treatment codes is bucketed from REAL structured data, not the free-text
// TREATMENT.treatment_done field (a dentist's typed note -- "Extracted tooth
// #36" -- which cannot be reliably parsed back into a code without guessing,
// and a wrong count on a clinical screen is worse than none):
//   - The 6 per-tooth codes (PFS/PF/TF/TR/X/SDF) come from ToothRecord.
//     treatment_code, joined up through DentalChart -> StudentIptr.
//   - The 4 whole-mouth codes (OEX/FV/OP/CONS) come from PreventiveCare
//     Record's own boolean fields, joined through StudentIptr directly.
// Aggregated server-side so the browser never pulls every tooth record in
// the school just to count them (the exact pattern /stats/student-rows'
// own history warns against -- see its comment above).
router.get("/stats/treatment-categories", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };

  const studentIds = (await Student.find(studentFilter).select("_id").lean()).map((s: any) => String(s._id));
  if (studentIds.length === 0) return res.json({ rows: [], schoolYearOptions: [], schoolYear: schoolYearLabel() });

  // Current school year only by default (user, 2026-09-27) -- a headcount
  // for "students given this treatment" that quietly summed every year the
  // clinic has ever recorded would overstate the current roll's actual
  // need. `school_year` is a TEMPORARY validation filter (user, 2026-09-27,
  // "for now make it a filter so i can validate if its showing the right
  // numbers") -- once the count is confirmed correct, the plan is to drop
  // back to always-current-year with no picker.
  const allIptrsInScope = await StudentIptr.find({ isArchived: false, student_id: { $in: studentIds } })
    .select("_id student_id school_year").lean();
  // The current year is always offered, even with zero IPTRs recorded yet --
  // otherwise a brand-new school year would have no way to select itself.
  const schoolYearOptions = [...new Set([schoolYearLabel(), ...(allIptrsInScope as any[]).map((i) => String(i.school_year))])]
    .filter(Boolean).sort().reverse();
  const requestedYear = typeof req.query.school_year === "string" && req.query.school_year ? req.query.school_year : schoolYearLabel();

  const iptrs = (allIptrsInScope as any[]).filter((i) => String(i.school_year) === requestedYear);
  const studentIdByIptr = new Map(iptrs.map((i: any) => [String(i._id), String(i.student_id)]));
  const iptrIds = iptrs.map((i: any) => String(i._id));
  if (iptrIds.length === 0) return res.json({ rows: [], schoolYearOptions, schoolYear: requestedYear });

  const [charts, preventives] = await Promise.all([
    DentalChart.find({ isArchived: false, iptr_id: { $in: iptrIds } }).select("_id iptr_id").lean(),
    PreventiveCareRecord.find({ isArchived: false, iptr_id: { $in: iptrIds } })
      .select("iptr_id oral_screening oral_prophylaxis fluoride_varnish consultation").lean(),
  ]);
  const iptrIdByChart = new Map(charts.map((c: any) => [String(c._id), String(c.iptr_id)]));
  const chartIds = charts.map((c: any) => String(c._id));

  const perToothCodeSet = new Set(perToothTreatmentCodes.map((t) => t.code));
  const toothRecords = chartIds.length
    ? await ToothRecord.find({ isArchived: false, chart_id: { $in: chartIds }, treatment_code: { $in: [...perToothCodeSet] } })
        .select("chart_id treatment_code").lean()
    : [];

  // code -> Set of student ids, built from whichever source (per-tooth or
  // whole-mouth) actually holds that code.
  const studentIdsByCode = new Map<string, Set<string>>();
  const add = (code: string, studentId: string | undefined) => {
    if (!studentId) return;
    if (!studentIdsByCode.has(code)) studentIdsByCode.set(code, new Set());
    studentIdsByCode.get(code)!.add(studentId);
  };

  for (const t of toothRecords as any[]) {
    const iptrId = iptrIdByChart.get(String(t.chart_id));
    const studentId = iptrId ? studentIdByIptr.get(iptrId) : undefined;
    if (t.treatment_code) add(String(t.treatment_code), studentId);
  }
  for (const p of preventives as any[]) {
    const studentId = studentIdByIptr.get(String(p.iptr_id));
    for (const [code, field] of Object.entries(WHOLE_MOUTH_CODE_TO_PREVENTIVE_FIELD)) {
      if ((p as any)[field] === true) add(code, studentId);
    }
  }

  const rows = [...studentIdsByCode.entries()].map(([code, ids]) => ({ code, studentIds: [...ids] }));
  res.json({ rows, schoolYearOptions, schoolYear: requestedYear });
}));

// Sprint 163: the School Admin dashboard's Treatments tile. A COUNT scoped to
// the caller's school(s), so the tile no longer needs the treatment records
// themselves (now clinical-read only), and no longer counts every school's.
router.get("/stats/treatment-count", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const students = await Student.find(scope ? { isArchived: false, ...scope } : { isArchived: false }).select("_id").lean();
  const iptrs = await StudentIptr.find({ isArchived: false, student_id: { $in: students.map((s: any) => s._id) } }).select("_id").lean();
  const count = await Treatment.countDocuments({ isArchived: false, iptr_id: { $in: iptrs.map((i: any) => i._id) } });
  res.json({ count });
}));

router.get("/stats/student-rows", requireAuth, asyncHandler(async (req, res) => {
  // This is the endpoint the Sprint 101 probe caught handing all three
  // schools' students to a school_admin pinned to one.
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const blind = isNameBlind(req);
  const [students, schools, iptrs, charts, preventives, risks, toothRecords, oralConditions, reviewRows] = await Promise.all([
    Student.find(studentFilter),
    School.find({ isArchived: false }).select("_id school_name").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id school_year").lean(),
    DentalChart.find({ isArchived: false }).select("_id iptr_id date_charted").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("_id iptr_id visit_number visit_date oral_screening oral_prophylaxis fluoride_varnish oral_hygiene_instruction consultation").lean(),
    // VALIDATED only (2026-10-01): `riskLevel` and `oralStatus` built from this
    // feed the Students list, every dashboard and the BHO table. A stored but
    // unreviewed suggestion is shown on the Risk Classification screen as
    // "Needs review", never here as the pupil's risk.
    RiskStratification.find({ isArchived: false, validated_by_dentist: true }).select("preventive_id risk_level recommendation").lean(),
    ToothRecord.find({ isArchived: false }).select("chart_id condition visit_number").lean(),
    OralHealthCondition.find({ isArchived: false }).select("iptr_id gingivitis periodontal_disease debris calculus abnormal_growth cleft_lip_palate others").lean(),
    // ALL rows, validated or not, but ONLY for the review chip (2026-10-01):
    // "Needs review" is exactly the unvalidated case. riskLevel/oralStatus
    // above still read validated rows only.
    RiskStratification.find({ isArchived: false }).select("preventive_id risk_level model_risk_level validated_by_dentist validated_at").lean(),
  ]);

  const schoolNameById = new Map(schools.map((s: any) => [String(s._id), String(s.school_name)]));
  // The review chip on the Students list: the SAME rule Risk Classification
  // uses (shared reviewSummary), judged on each pupil's latest RPC visit.
  const reviewRowsByPreventive = new Map<string, any[]>();
  for (const r of reviewRows as any[]) {
    const k = String(r.preventive_id);
    const list = reviewRowsByPreventive.get(k) ?? [];
    list.push(r);
    reviewRowsByPreventive.set(k, list);
  }
  const visitsByIptr = new Map<string, any[]>();
  for (const p of preventives as any[]) {
    if (!p.visit_date) continue;
    const k = String(p.iptr_id);
    const list = visitsByIptr.get(k) ?? [];
    list.push(p);
    visitsByIptr.set(k, list);
  }
  const iptrsByStudent = new Map<string, string[]>();
  for (const i of iptrs as any[]) {
    const list = iptrsByStudent.get(String(i.student_id)) ?? [];
    list.push(String(i._id));
    iptrsByStudent.set(String(i.student_id), list);
  }
  // This year's own iptr per student, for the treatment-pipeline Status
  // column below -- a returning pupil who finished both visits LAST year
  // is "For Oral Exam" again this year, not "Completed" forever.
  const currentYear = schoolYearLabel();
  const currentIptrByStudent = new Map(
    (iptrs as any[]).filter((i) => String(i.school_year) === currentYear).map((i) => [String(i.student_id), String(i._id)]),
  );
  const iptrIdByChart = new Map<string, string>();
  for (const c of charts as any[]) iptrIdByChart.set(String(c._id), String(c.iptr_id));
  // "Has had the oral exam this year" for the Status column below -- NOT
  // just "a DentalChart row exists for this iptr" (user, 2026-09-28: a
  // pupil whose chart was created, then had every condition/treatment
  // cleared back out and saved empty, still showed "For Visit 1" forever
  // after that, because the row itself never gets archived -- see
  // DentalChart.tsx's handleSave, which only ever ADDS tooth records or
  // archives individually CLEARED ones, never the chart row as a whole).
  // Real content is a live ToothRecord with a condition, OR a ticked oral
  // condition -- the exact same "hasChartOrOralConditionData" test the
  // client itself uses to decide whether a save queues the pupil for
  // Treatment, so the two can't disagree about what "real" means here.
  const hasRealChartDataByIptr = new Set<string>();
  for (const t of toothRecords as any[]) {
    if (!t.condition) continue;
    const iptrId = iptrIdByChart.get(String(t.chart_id));
    if (iptrId) hasRealChartDataByIptr.add(iptrId);
  }
  for (const o of oralConditions as any[]) {
    const ticked = o.gingivitis || o.periodontal_disease || o.debris || o.calculus || o.abnormal_growth || o.cleft_lip_palate || (typeof o.others === "string" && o.others.trim() !== "");
    if (ticked) hasRealChartDataByIptr.add(String(o.iptr_id));
  }
  // "Last Dental Visit" (below) is the LATEST of the oral condition's
  // Date examined (DENTAL_CHART.date_charted) AND either RPC visit's own
  // Date treated -- same reasoning as the Status column above (user,
  // 2026-09-28, first pass: "the last dental visit should be the last
  // latest recorded date on the dental chart"; second pass: "it should
  // reflect any latest date recorded ... may it be the oral condition date,
  // treatment date for visit 1 or 2" -- date_charted alone missed a visit
  // treated on a LATER date than the oral exam). An empty chart shell or an
  // empty preventive record (a date was stamped but nothing real was ever
  // ticked or charted) is not a visit that happened, so its date must not
  // count as one -- same "real content" test DentalChart.tsx's own
  // hasRealVisitData uses client-side.
  const chartDatesByIptr = new Map<string, Date[]>();
  for (const c of charts as any[]) {
    if (!c.date_charted || !hasRealChartDataByIptr.has(String(c.iptr_id))) continue;
    const list = chartDatesByIptr.get(String(c.iptr_id)) ?? [];
    list.push(new Date(c.date_charted));
    chartDatesByIptr.set(String(c.iptr_id), list);
  }
  const toothRecordsByIptr = new Map<string, any[]>();
  for (const t of toothRecords as any[]) {
    const iptrId = iptrIdByChart.get(String(t.chart_id));
    if (!iptrId) continue;
    const list = toothRecordsByIptr.get(iptrId) ?? [];
    list.push(t);
    toothRecordsByIptr.set(iptrId, list);
  }
  const hasRealPreventiveData = (p: any) => {
    if ([p.oral_screening, p.oral_prophylaxis, p.fluoride_varnish, p.oral_hygiene_instruction, p.consultation].some((v: any) => v === true)) return true;
    const teeth = toothRecordsByIptr.get(String(p.iptr_id)) ?? [];
    return p.visit_number === 2
      ? teeth.some((t: any) => t.condition && t.visit_number === 2)
      : teeth.some((t: any) => t.condition && (t.visit_number ?? 1) !== 2);
  };
  for (const p of preventives as any[]) {
    if (!p.visit_date || !hasRealPreventiveData(p)) continue;
    const iptrId = String(p.iptr_id);
    const list = chartDatesByIptr.get(iptrId) ?? [];
    list.push(new Date(p.visit_date));
    chartDatesByIptr.set(iptrId, list);
  }
  const visitNumbersByIptr = new Map<string, Set<number>>();
  for (const p of preventives as any[]) {
    const iptrId = String(p.iptr_id);
    if (!visitNumbersByIptr.has(iptrId)) visitNumbersByIptr.set(iptrId, new Set());
    if (p.visit_number === 1 || p.visit_number === 2) visitNumbersByIptr.get(iptrId)!.add(p.visit_number);
  }
  const preventiveIptrById = new Map((preventives as any[]).map((p) => [String(p._id), String(p.iptr_id)]));
  const riskByIptr = new Map<string, string>();
  const recommendationByIptr = new Map<string, string>();
  for (const r of risks as any[]) {
    const iptrId = preventiveIptrById.get(String(r.preventive_id));
    if (iptrId) {
      riskByIptr.set(iptrId, String(r.risk_level));
      recommendationByIptr.set(iptrId, String(r.recommendation ?? ""));
    }
  }

  // Mirrors deriveOralStatus in the client hook — kept identical on purpose so
  // the row means the same thing wherever it is built.
  const deriveOralStatus = (risk: string | null) =>
    risk === "High" ? "Needs Treatment"
      : risk === "Medium" ? "Under Treatment"
        : risk === "Low" ? "Orally Fit"
          : "Not Yet Screened";

  // Student Records' Status column (user, 2026-09-28) -- the treatment
  // PIPELINE for THIS school year specifically, distinct from riskLevel's
  // clinical severity above. No current-year iptr, or an iptr with no
  // dental chart on it yet, means the oral exam itself hasn't happened;
  // once charted, RPC Visit 1 then Visit 2 are what "First"/"Second
  // Treatment" refer to (see shared/rpcTracking.ts for the same two-visit
  // model this mirrors).
  const derivePipelineStatus = (studentId: string): "For Oral Exam" | "For First Treatment" | "For Second Treatment" | "Completed" => {
    const iptrId = currentIptrByStudent.get(studentId);
    if (!iptrId || !hasRealChartDataByIptr.has(iptrId)) return "For Oral Exam";
    const visits = visitNumbersByIptr.get(iptrId);
    if (!visits?.has(1)) return "For First Treatment";
    if (!visits.has(2)) return "For Second Treatment";
    return "Completed";
  };

  const rows = (students as any[]).map((s) => {
    const studentIptrs = iptrsByStudent.get(String(s._id)) ?? [];
    const chartDates = studentIptrs.flatMap((id) => chartDatesByIptr.get(id) ?? []);
    // First iptr carrying a risk wins, matching the badge and the old client
    // join; `find(Boolean)` over the iptrs in insertion order.
    const riskLevel = studentIptrs.map((id) => riskByIptr.get(id)).find(Boolean) ?? null;
    // Same iptr the risk level came from, so the two never disagree about
    // which assessment they're describing.
    const recommendation = studentIptrs.map((id) => recommendationByIptr.get(id)).find(Boolean) ?? "";
    const visits = studentIptrs
      .flatMap((id) => visitsByIptr.get(id) ?? [])
      .sort((a, b) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());
    const latestVisit = visits[visits.length - 1];
    const review = reviewSummary(!!latestVisit, latestVisit ? reviewRowsByPreventive.get(String(latestVisit._id)) ?? [] : []);
    const n = studentNames(s, blind);
    const last = n.last_name.trim();
    const first = n.first_name.trim();
    return {
      id: String(s._id),
      // surnameFirst() from the client util, same fallbacks.
      name: !last && !first ? n.full_name.trim() : !last ? first : !first ? last : `${last}, ${first}`,
      lastName: n.last_name,
      firstName: n.first_name,
      middleName: n.middle_name,
      birthdate: s.birthday ? new Date(s.birthday).toISOString().slice(0, 10) : "",
      gender: s.sex,
      grade: s.grade_level,
      section: s.section,
      school: schoolNameById.get(String(s.school_id)) ?? "Unknown School",
      lastVisit: chartDates.length
        ? new Date(Math.max(...chartDates.map((d) => d.getTime()))).toISOString()
        : null,
      oralStatus: deriveOralStatus(riskLevel),
      riskLevel,
      recommendation,
      riskReview: { status: review.status, level: review.level, reviewedAt: review.reviewedAt },
      pipelineStatus: derivePipelineStatus(String(s._id)),
      consentStatus: s.consent_status,
    };
  });

  // Alphabetical by surname, the order the clinic reads its lists in and the
  // order the DOH forms are filled. Sorted HERE so every consumer inherits it
  // rather than each list re-sorting (or forgetting to). Compares the real name
  // PARTS, not the derived "Last, First" string, so a middle name never affects
  // where a row lands.
  rows.sort((a, b) =>
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName) ||
    a.middleName.localeCompare(b.middleName));

  res.json(rows);
}));

// Clinical models — all 5 roles can read (school_admin/bho_staff need this
// for dashboards/reports per CLAUDE.md's own role descriptions), but only
// clinical staff (+ System Admin as super user) can create/edit. Archive/
// restore/view-archived stays System Admin only everywhere (crudFactory's
// default), matching CLAUDE.md's SOFT DELETE RULES exactly.
// duplicateCheck: the same child gets encoded twice often enough to matter —
// once by OCR off the paper IPTR and once by hand. It warns rather than
// blocks (a 409 carrying the matches), so the person encoding decides whether
// it is really the same child; two children genuinely sharing a name and a
// birthday in one school is rare but possible. Sitting on the route means the
// add form, bulk import, OCR and offline replay are all covered by one rule.
// filterable/filterableText (Sprint 56): the appointments screen needs two
// narrow slices of this collection — the students an appointment set actually
// references (by _id), and the roster of one section for the create form — and
// used to get both by pulling all ~8,000 students into the browser.
router.use("/students", createCrudRouter(Student, {
  writeRoles: CLINICAL_WRITE_ROLES,
  duplicateCheck: findDuplicateStudents,
  // The SAME rules the forms run (shared/studentValidation.ts), enforced where
  // no client can skip them. Sprint 120 put these on the Add form, the bulk
  // import and the chart's edit panel; the offline queue replays POSTs straight
  // to this API and passes through none of them.
  //
  // Only fields PRESENT in the body are checked -- a PUT is partial, and
  // validating absent fields would block an unrelated edit on a legacy value.
  validateBody: (body) => {
    const pick = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    const birthdayRaw = body.birthday;
    return validateStudentValues({
      lastName: pick("last_name"),
      firstName: pick("first_name"),
      middleName: pick("middle_name"),
      birthdate: birthdayRaw === undefined || birthdayRaw === null
        ? undefined
        : String(birthdayRaw).slice(0, 10),
      contactNumber: pick("contact_number"),
      guardianContact: pick("guardian_contact"),
    });
  },
  filterable: ["_id", "school_id"],
  filterableText: ["grade_level", "section"],
  // A school_admin's two screens need the ROWS (counts by grade, sex and age
  // bracket) and none of the identity on them. See CrudOptions.redact.
  // `birthday` stays: the DOH age brackets are computed from it.
  redact: {
    roles: ["school_admin"],
    fields: [
      "full_name", "first_name", "last_name", "middle_name",
      "address", "contact_number", "guardian_name", "guardian_contact",
      "philhealth_number", "fourps_id", "place_of_birth", "guardian_occupation",
    ],
  },
}));
// archiveRoles: the chart's "Edit Years → remove year" button is shown to the
// dentist, but archive defaulted to System Admin only, so every click 403'd and
// an accidentally added school year could not be removed. Restore stays admin
// only (restoreRoles default), per the soft-delete rule in CLAUDE.md.
// Sprint 163 (SEC-19): clinical records are READ by the clinic + System Admin
// (CLINICAL_READ_ROLES). Reads used to default to every role, so a School Admin
// could list every pupil's medical history. Three collections stay readable by
// BHO staff for the named Target Client List / Consent Form (Part B decision).
router.use("/student-iptrs", createCrudRouter(StudentIptr, { readRoles: CLINICAL_READ_ROLES_AND_BHO, writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: ["system_admin", "dentist"], uniqueBy: ["student_id", "school_year"], filterable: ["student_id"] }));
router.use("/medical-histories", createCrudRouter(MedicalHistory, { readRoles: CLINICAL_READ_ROLES, writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dietary-social-habits", createCrudRouter(DietarySocialHabits, { readRoles: CLINICAL_READ_ROLES, writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/oral-health-conditions", createCrudRouter(OralHealthCondition, { readRoles: CLINICAL_READ_ROLES_AND_BHO, writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dental-charts", createCrudRouter(DentalChart, { readRoles: CLINICAL_READ_ROLES, writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
// archiveRoles: a dentist who clears every code off a tooth and saves retires
// that tooth's record -- the chart's own "empty this tooth" action. Before this
// the archive route was ADMIN_ONLY, so the chart could not persist a cleared
// tooth at all and the old codes returned on reload. Restore stays admin-only.
router.use("/tooth-records", createCrudRouter(ToothRecord, { readRoles: CLINICAL_READ_ROLES, writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: ["system_admin", "dentist"], filterable: ["chart_id"] }));
router.use("/treatments", createCrudRouter(Treatment, { readRoles: CLINICAL_READ_ROLES, writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
// archiveRoles: CLINICAL_WRITE_ROLES (2026-09-28) -- DentalChart.tsx's own
// save archives a visit whose services/teeth were all cleared out (see
// handleSave), and that save is available to dentist AND dental_aide, same
// as the write itself; defaulting to ADMIN_ONLY here would 403 an aide's
// own save the moment it tried to clear a visit empty.
router.use("/preventive-care-records", createCrudRouter(PreventiveCareRecord, { readRoles: CLINICAL_READ_ROLES_AND_BHO, writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
// The audit action records whether the dentist accepted the AI suggestion
// as-is or changed it (Chapter 4 evidence for the dentist-validates-model
// gate). `model_risk_level` / `recommendation_edited` ride in the request
// body for this comparison only — the schema is strict, so they never persist.
// SEC-35 (2026-10-01): DENTIST ONLY. The single writer in the app is the
// dentist's "Validate & Save" on Risk Classification, and every row it creates
// is a clinical sign-off: CLAUDE.md's core rule is that the dentist validates
// ALL recommendations. This used to be CLINICAL_WRITE_ROLES, so a System Admin
// or Dental Aide could create a row the audit trail below then describes as
// "dentist validated". Seed scripts write through the model, not this route.
router.use("/risk-stratifications", createCrudRouter(RiskStratification, {
  readRoles: CLINICAL_READ_ROLES,
  writeRoles: ["dentist"],
  // ⚠ "dentist validated" ONLY when the row really is validated (2026-10-01).
  // Suggestions are now stored UNvalidated, and the old line said "dentist
  // validated: accepted AI suggestion" for any body carrying a model level,
  // which would have recorded a validation that never happened.
  auditCreateAction: (body) => {
    if (typeof body.model_risk_level !== "string") return undefined;
    if (body.validated_by_dentist !== true) {
      return `Created RiskStratification (system suggestion ${body.model_risk_level}, awaiting dentist review)`;
    }
    // ⚠ Keep every line under AUDIT_TRAIL.action's 100 characters (logAudit
    // trims as a safety net, but a whole line is better than a trimmed one).
    const accepted = body.model_risk_level === body.risk_level;
    const recEdited = body.recommendation_edited === true ? "; recommendation edited" : "";
    return accepted
      ? `Created RiskStratification (dentist validated ${body.risk_level}: kept suggestion${recEdited})`
      : `Created RiskStratification (dentist validated ${body.risk_level}: changed from ${body.model_risk_level}${recEdited})`;
  },
  // The dentist's review of a stored suggestion is a PUT (the popup's "Save review").
  auditUpdateAction: (doc) => {
    if (doc.validated_by_dentist !== true) return undefined;
    const model = typeof doc.model_risk_level === "string" ? doc.model_risk_level : null;
    const decisions = Array.isArray(doc.treatment_decisions) ? (doc.treatment_decisions as { decision?: string }[]) : [];
    const accepted = decisions.filter((d) => d.decision === "accepted").length;
    const skipped = decisions.filter((d) => d.decision === "skipped").length;
    const how = model === null ? "no suggestion" : model === doc.risk_level ? "kept suggestion" : `changed from ${model}`;
    return `Updated RiskStratification (dentist validated ${doc.risk_level}: ${how}; ${accepted} accepted, ${skipped} skipped)`;
  },
}));
// dateField (Sprint 56): the Completed and Missed tabs have no self-limiting
// date the way Today and Upcoming do, so without a bound they grow forever.
router.use("/appointments", createCrudRouter(Appointment, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: CLINICAL_WRITE_ROLES, dateField: "appointment_datetime" }));
// School Rotation tab (2026-09-24, user-approved; ERD DEVIATION — see
// docs/DATA-MODEL.md). One record per DAY (week_start = week_end = that day).
// `dateField` bounds the tab's week/month reads; `dentist_id` narrows to one
// dentist. archiveRoles: the tab's "Clear day" is a dentist/aide action on a
// schedule they keep, not a clinical record; restore stays admin-only.
router.use("/dentist-rotations", createCrudRouter(DentistRotation, {
  readRoles: CLINICAL_READ_ROLES,
  writeRoles: CLINICAL_WRITE_ROLES,
  archiveRoles: CLINICAL_WRITE_ROLES,
  dateField: "week_start",
  filterable: ["dentist_id"],
}));

// Sprint 108 — notes written against a DATE rather than a patient. `dateField`
// bounds the read to the month the calendar is showing, the same treatment
// Sprint 56 gave appointments; without it this becomes another unbounded
// collection read the moment a year of holidays exists.
// ⚠ `archiveRoles` MUST be set. It defaults to ADMIN_ONLY, so the dentist and
// aide could CREATE a day note but not remove one — and the panel shows them a
// remove button, which 403'd. A control that appears to work must work. Restore
// stays admin-only per CLAUDE.md's soft-delete rule; this only governs archiving
// a note you just wrote, which is the "typed it on the wrong day" case.
router.use("/day-notes", createCrudRouter(DayNote, {
  readRoles: CLINICAL_READ_ROLES,
  writeRoles: CLINICAL_WRITE_ROLES,
  archiveRoles: CLINICAL_WRITE_ROLES,
  dateField: "date",
}));

// Sprint 127 — referrals. `dateField` bounds the reports' sweep the way
// Sprint 56 did for appointments; `filterable: ["iptr_id"]` serves the student
// record's Referrals tab.
//
// ⚠ Sprint 129 corrected this block. It originally granted
// `archiveRoles: CLINICAL_WRITE_ROLES`, justified by "the tab shows the dentist
// a remove button" — copied from the DAY_NOTE reasoning above without checking,
// and the Referrals tab has NO such button. The grant was dead code and the
// comment would have told the next reader an archive path had been tested.
// Archiving therefore stays at the ADMIN_ONLY default, which also matches
// TREATMENT, the model a referral most resembles. If a dentist ever needs to
// withdraw a referral she typed by mistake, add the button AND the grant
// together — a control that appears to work must work, and so must its absence
// be deliberate.
router.use("/referrals", createCrudRouter(Referral, {
  readRoles: CLINICAL_READ_ROLES,
  writeRoles: CLINICAL_WRITE_ROLES,
  filterable: ["iptr_id"],
  dateField: "date_issued",
}));

// Audit trail — System Admin only, both to read and (already, since Sprint 6)
// impossible to write directly; entries are created internally via logAudit().
// dateField (Sprint 92): the audit trail is the fastest-growing collection in
// the system — every action, every user, three schools, forever — and this
// route returned ALL of it. Unlike the appointment window it has no natural
// boundary, so the client sends an explicit `from`, and "show earlier" widens
// it. AuditTrail has no isArchived, so the date range is the only filter.
// Whose record each audit entry touched (System Admin only). The trail stores
// just a model name and a record id, so "Updated a student IPTR" could not say
// WHICH student. This walks each patient-linked record up to its student and
// returns { recordId: studentName } for the same date window the trail uses.
// Archived records are included on purpose: an "Archived ..." entry points at
// a record that is archived by then. Names come back decrypted because the
// Student docs are read as documents, not lean objects.
router.get("/audit-subjects", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const filter: Record<string, unknown> = {};
  if (from && !Number.isNaN(from.getTime())) filter.timestamp = { $gte: from };
  const entries = await AuditTrail.find(filter).select("affected_model affected_record_id").lean<{ affected_model: string; affected_record_id: unknown }[]>();
  // affected_record_id is an ObjectId in the model, so lean() hands back ObjectIds, not strings.
  const rows = entries.map((e) => ({ model: e.affected_model, id: String(e.affected_record_id) }));

  const valid = (id: unknown): id is string => typeof id === "string" && mongoose.isValidObjectId(id);
  const idsOf = (models: string[]) =>
    [...new Set(rows.filter((r) => models.includes(r.model) && valid(r.id)).map((r) => r.id))];
  const asStr = (v: unknown) => (v == null ? null : String(v));

  // record id -> student id
  const studentOf = new Map<string, string>();
  for (const id of idsOf(["Student"])) studentOf.set(id, id);

  const apps = idsOf(["Appointment"]);
  if (apps.length) {
    for (const d of await Appointment.find({ _id: { $in: apps } }).select("student_id").lean<{ _id: unknown; student_id: unknown }[]>()) {
      const s = asStr(d.student_id); if (s) studentOf.set(String(d._id), s);
    }
  }

  // Everything hung off an IPTR: iptr id per record
  const viaIptr = new Map<string, string>(); // record id -> iptr id
  const iptrModels: [string, any][] = [
    ["MedicalHistory", MedicalHistory], ["DietarySocialHabits", DietarySocialHabits], ["OralHealthCondition", OralHealthCondition],
    ["PreventiveCareRecord", PreventiveCareRecord], ["Treatment", Treatment], ["Referral", Referral], ["DentalChart", DentalChart],
  ];
  for (const [name, Model] of iptrModels) {
    const ids = idsOf([name]);
    if (!ids.length) continue;
    for (const d of await Model.find({ _id: { $in: ids } }).select("iptr_id").lean()) {
      const i = asStr(d.iptr_id); if (i) viaIptr.set(String(d._id), i);
    }
  }
  // Two hops: tooth record -> chart -> iptr, risk assessment -> preventive -> iptr
  const teeth = idsOf(["ToothRecord"]);
  if (teeth.length) {
    const rows = await ToothRecord.find({ _id: { $in: teeth } }).select("chart_id").lean<{ _id: unknown; chart_id: unknown }[]>();
    const chartIds = rows.map((r) => asStr(r.chart_id)).filter(Boolean) as string[];
    const charts = await DentalChart.find({ _id: { $in: chartIds } }).select("iptr_id").lean<{ _id: unknown; iptr_id: unknown }[]>();
    const iptrByChart = new Map(charts.map((c) => [String(c._id), asStr(c.iptr_id)]));
    for (const r of rows) { const i = iptrByChart.get(String(r.chart_id)); if (i) viaIptr.set(String(r._id), i); }
  }
  const risks = idsOf(["RiskStratification"]);
  if (risks.length) {
    const rows = await RiskStratification.find({ _id: { $in: risks } }).select("preventive_id").lean<{ _id: unknown; preventive_id: unknown }[]>();
    const prevIds = rows.map((r) => asStr(r.preventive_id)).filter(Boolean) as string[];
    const prevs = await PreventiveCareRecord.find({ _id: { $in: prevIds } }).select("iptr_id").lean<{ _id: unknown; iptr_id: unknown }[]>();
    const iptrByPrev = new Map(prevs.map((p) => [String(p._id), asStr(p.iptr_id)]));
    for (const r of rows) { const i = iptrByPrev.get(String(r.preventive_id)); if (i) viaIptr.set(String(r._id), i); }
  }

  // IPTR -> student (covers the StudentIptr entries themselves too)
  const iptrIds = [...new Set([...idsOf(["StudentIptr"]), ...viaIptr.values()])];
  const studentByIptr = new Map<string, string>();
  if (iptrIds.length) {
    for (const d of await StudentIptr.find({ _id: { $in: iptrIds } }).select("student_id").lean<{ _id: unknown; student_id: unknown }[]>()) {
      const s = asStr(d.student_id); if (s) studentByIptr.set(String(d._id), s);
    }
  }
  for (const id of idsOf(["StudentIptr"])) { const s = studentByIptr.get(id); if (s) studentOf.set(id, s); }
  for (const [rec, iptr] of viaIptr) { const s = studentByIptr.get(iptr); if (s) studentOf.set(rec, s); }

  const studentIds = [...new Set(studentOf.values())];
  const names = new Map<string, string>();
  if (studentIds.length) {
    for (const s of await Student.find({ _id: { $in: studentIds } })) names.set(String(s._id), (s as any).full_name ?? "");
  }
  const out: Record<string, string> = {};
  for (const [rec, stu] of studentOf) { const n = names.get(stu); if (n) out[rec] = n; }
  res.json(out);
}));

router.use("/audit-trails", createCrudRouter(AuditTrail, { readOnly: true, readRoles: ADMIN_ONLY, dateField: "timestamp" }));

export default router;
