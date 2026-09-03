import { Router } from "express";
import { getHealth } from "../controllers/healthController.js";
import { createUser, resetPassword, sendResetLink, initiateTwofa, confirmTwofa, disableTwofa } from "../controllers/userController.js";
import { createCrudRouter } from "./crudFactory.js";
import authRoutes from "./authRoutes.js";
import predictionRoutes from "./predictionRoutes.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ADMIN_ONLY, CLINICAL_WRITE_ROLES } from "../middleware/roleGroups.js";
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
} from "../models/index.js";

const router = Router();

router.get("/health", getHealth);
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
router.post("/users", requireAuth, requireRole(...ADMIN_ONLY), asyncHandler(createUser));
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
router.get("/stats/high-risk-count", requireAuth, asyncHandler(async (req, res) => {
  const schoolName = typeof req.query.school === "string" ? req.query.school : null;
  let studentFilter: Record<string, unknown> = { isArchived: false };
  if (schoolName) {
    const school = await School.findOne({ school_name: schoolName, isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
    if (!school) { res.json({ count: 0 }); return; }
    studentFilter = { ...studentFilter, school_id: school._id };
  }
  const [students, iptrs, preventives, risks] = await Promise.all([
    Student.find(studentFilter).select("_id").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("_id iptr_id").lean(),
    RiskStratification.find({ isArchived: false }).select("preventive_id risk_level").lean(),
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
router.get("/stats/notifications", requireAuth, asyncHandler(async (req, res) => {
  const schoolName = typeof req.query.school === "string" ? req.query.school : null;
  let studentFilter: Record<string, unknown> = { isArchived: false };
  let schoolId: unknown = null;
  if (schoolName) {
    const school = await School.findOne({ school_name: schoolName, isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
    if (!school) { res.json({ overdueRpc: 0, appointmentsToday: 0, awaitingValidation: 0, remindersToday: 0 }); return; }
    schoolId = school._id;
    studentFilter = { ...studentFilter, school_id: school._id };
  }

  // Today in the SERVER's local day. The clinic and the server share a
  // timezone; if that ever stops being true this needs the client's offset,
  // because "today's appointments" is a local-day question, not a UTC one.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  const [students, iptrs, preventives, risks, appointmentsToday, remindersToday] = await Promise.all([
    Student.find(studentFilter).select("_id").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("iptr_id visit_number visit_date").lean(),
    RiskStratification.find({ isArchived: false }).select("preventive_id validated_by_dentist").lean(),
    Appointment.countDocuments({
      isArchived: false,
      appointment_datetime: { $gte: dayStart, $lt: dayEnd },
    }),
    // Calendar reminders (stored on DentistRotation, repurposed as a single-
    // day note — week_start/week_end both set to the note's date) whose
    // range covers today.
    DentistRotation.countDocuments({
      isArchived: false,
      ...(schoolId ? { school_id: schoolId } : {}),
      week_start: { $lte: dayEnd },
      week_end: { $gte: dayStart },
    }),
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

  const preventiveIptr = new Map(preventives.map((p) => [String((p as { _id?: unknown })._id), String(p.iptr_id)]));
  let awaitingValidation = 0;
  for (const r of risks) {
    if (r.validated_by_dentist) continue;
    const iptrId = preventiveIptr.get(String(r.preventive_id));
    // A risk row whose preventive record is outside the selected school must
    // not be counted; without the scope check the badge would ignore the
    // school switcher entirely.
    if (iptrId && scopedIptrIds.has(iptrId)) awaitingValidation++;
  }

  res.json({ overdueRpc, appointmentsToday, awaitingValidation, remindersToday });
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
router.get("/stats/student-rows", requireAuth, asyncHandler(async (_req, res) => {
  const [students, schools, iptrs, charts, preventives, risks] = await Promise.all([
    Student.find({ isArchived: false }),
    School.find({ isArchived: false }).select("_id school_name").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id").lean(),
    DentalChart.find({ isArchived: false }).select("iptr_id date_charted").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("_id iptr_id").lean(),
    RiskStratification.find({ isArchived: false }).select("preventive_id risk_level").lean(),
  ]);

  const schoolNameById = new Map(schools.map((s: any) => [String(s._id), String(s.school_name)]));
  const iptrsByStudent = new Map<string, string[]>();
  for (const i of iptrs as any[]) {
    const list = iptrsByStudent.get(String(i.student_id)) ?? [];
    list.push(String(i._id));
    iptrsByStudent.set(String(i.student_id), list);
  }
  const chartDatesByIptr = new Map<string, Date[]>();
  for (const c of charts as any[]) {
    if (!c.date_charted) continue;
    const list = chartDatesByIptr.get(String(c.iptr_id)) ?? [];
    list.push(new Date(c.date_charted));
    chartDatesByIptr.set(String(c.iptr_id), list);
  }
  const preventiveIptrById = new Map((preventives as any[]).map((p) => [String(p._id), String(p.iptr_id)]));
  const riskByIptr = new Map<string, string>();
  for (const r of risks as any[]) {
    const iptrId = preventiveIptrById.get(String(r.preventive_id));
    if (iptrId) riskByIptr.set(iptrId, String(r.risk_level));
  }

  // Mirrors deriveOralStatus in the client hook — kept identical on purpose so
  // the row means the same thing wherever it is built.
  const deriveOralStatus = (risk: string | null) =>
    risk === "High" ? "Needs Treatment"
      : risk === "Medium" ? "Under Treatment"
        : risk === "Low" ? "Orally Fit"
          : "Not Yet Screened";

  const rows = (students as any[]).map((s) => {
    const studentIptrs = iptrsByStudent.get(String(s._id)) ?? [];
    const chartDates = studentIptrs.flatMap((id) => chartDatesByIptr.get(id) ?? []);
    // First iptr carrying a risk wins, matching the badge and the old client
    // join; `find(Boolean)` over the iptrs in insertion order.
    const riskLevel = studentIptrs.map((id) => riskByIptr.get(id)).find(Boolean) ?? null;
    const last = (s.last_name ?? "").trim();
    const first = (s.first_name ?? "").trim();
    return {
      id: String(s._id),
      // surnameFirst() from the client util, same fallbacks.
      name: !last && !first ? (s.full_name ?? "").trim() : !last ? first : !first ? last : `${last}, ${first}`,
      lastName: s.last_name ?? "",
      firstName: s.first_name ?? "",
      middleName: s.middle_name ?? "",
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
// archiveRoles: default is System Admin only, but Update School Year's
// "Archive Selected" (bulk transfer) is used by the dentist/dental aide who
// already reach this whole screen — same widening already done below for
// student-iptrs, and for the same reason.
router.use("/students", createCrudRouter(Student, {
  writeRoles: CLINICAL_WRITE_ROLES,
  archiveRoles: CLINICAL_WRITE_ROLES,
  duplicateCheck: findDuplicateStudents,
  filterable: ["_id", "school_id"],
  filterableText: ["grade_level", "section"],
}));
// archiveRoles: the chart's "Edit Years → remove year" button is shown to the
// dentist, but archive defaulted to System Admin only, so every click 403'd and
// an accidentally added school year could not be removed. Restore stays admin
// only (restoreRoles default), per the soft-delete rule in CLAUDE.md.
router.use("/student-iptrs", createCrudRouter(StudentIptr, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: ["system_admin", "dentist"], uniqueBy: ["student_id", "school_year"], filterable: ["student_id"] }));
router.use("/medical-histories", createCrudRouter(MedicalHistory, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dietary-social-habits", createCrudRouter(DietarySocialHabits, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/oral-health-conditions", createCrudRouter(OralHealthCondition, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dental-charts", createCrudRouter(DentalChart, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/tooth-records", createCrudRouter(ToothRecord, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["chart_id"] }));
router.use("/treatments", createCrudRouter(Treatment, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/preventive-care-records", createCrudRouter(PreventiveCareRecord, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
// The audit action records whether the dentist accepted the AI suggestion
// as-is or changed it (Chapter 4 evidence for the dentist-validates-model
// gate). `model_risk_level` / `recommendation_edited` ride in the request
// body for this comparison only — the schema is strict, so they never persist.
router.use("/risk-stratifications", createCrudRouter(RiskStratification, {
  writeRoles: CLINICAL_WRITE_ROLES,
  auditCreateAction: (body) => {
    if (typeof body.model_risk_level !== "string") return undefined;
    const accepted = body.model_risk_level === body.risk_level;
    const recEdited = body.recommendation_edited === true ? "; recommendation edited" : "";
    return accepted
      ? `Created RiskStratification (dentist validated: accepted AI suggestion ${body.risk_level}${recEdited})`
      : `Created RiskStratification (dentist validated: changed AI suggestion ${body.model_risk_level} → ${body.risk_level}${recEdited})`;
  },
}));
// dateField (Sprint 56): the Completed and Missed tabs have no self-limiting
// date the way Today and Upcoming do, so without a bound they grow forever.
// archiveRoles widened (default is System Admin only): the Today tab's
// per-row delete is used by the dentist/dental aide who book these
// appointments in the first place.
router.use("/appointments", createCrudRouter(Appointment, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: CLINICAL_WRITE_ROLES, dateField: "appointment_datetime" }));
// archiveRoles widened (default is System Admin only): DentistRotation now
// doubles as the calendar's per-day note, created and deleted by the same
// dentist/dental_aide who use the calendar tab.
router.use("/dentist-rotations", createCrudRouter(DentistRotation, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: CLINICAL_WRITE_ROLES }));

// Audit trail — System Admin only, both to read and (already, since Sprint 6)
// impossible to write directly; entries are created internally via logAudit().
// dateField (Sprint 92): the audit trail is the fastest-growing collection in
// the system — every action, every user, three schools, forever — and this
// route returned ALL of it. Unlike the appointment window it has no natural
// boundary, so the client sends an explicit `from`, and "show earlier" widens
// it. AuditTrail has no isArchived, so the date range is the only filter.
router.use("/audit-trails", createCrudRouter(AuditTrail, { readOnly: true, readRoles: ADMIN_ONLY, dateField: "timestamp" }));

export default router;
