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
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ADMIN_ONLY, CLINICAL_WRITE_ROLES } from "../middleware/roleGroups.js";
import { aggregateDohReport } from "../../shared/dohAggregate.js";
import { buildRiskCandidates, filterRiskCandidates } from "../../shared/riskCandidates.js";
import { buildRpcRows, filterRpcRows } from "../../shared/rpcTracking.js";
import { buildSchoolSummary } from "../../shared/schoolSummary.js";
import { buildFhsisCounts } from "../../shared/fhsis.js";
import { buildReportsPanels } from "../../shared/reportsPanels.js";
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
  if (schoolName) {
    const school = await School.findOne({ school_name: schoolName, isArchived: false }).select("_id").lean<{ _id: unknown } | null>();
    if (!school) { res.json({ overdueRpc: 0, appointmentsToday: 0, awaitingValidation: 0 }); return; }
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

  const [students, iptrs, preventives, risks, appointmentsToday] = await Promise.all([
    Student.find(studentFilter).select("_id").lean(),
    StudentIptr.find({ isArchived: false }).select("_id student_id").lean(),
    PreventiveCareRecord.find({ isArchived: false }).select("iptr_id visit_number visit_date").lean(),
    RiskStratification.find({ isArchived: false }).select("preventive_id validated_by_dentist").lean(),
    Appointment.countDocuments({
      isArchived: false,
      appointment_datetime: { $gte: dayStart, $lt: dayEnd },
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

  res.json({ overdueRpc, appointmentsToday, awaitingValidation });
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
  const out = buildReportsPanels({
    students: (students as any[]).map((s) => ({
      _id: str(s._id),
      school_id: str(s.school_id),
      sex: str(s.sex),
      grade_level: str(s.grade_level),
      last_name: s.last_name ?? "",
      first_name: s.first_name ?? "",
      middle_name: s.middle_name ?? "",
      full_name: s.full_name ?? "",
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
    referrals: (referrals as any[]).map((r) => ({
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
  const rows = buildRpcRows({
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

router.get("/stats/risk-candidates", requireAuth, asyncHandler(async (req, res) => {
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const active = { isArchived: false };

  const [students, schools, iptrs, charts, toothRecords, orals, dietaries, preventives, risks] = await Promise.all([
    Student.find(studentFilter),
    School.find(active).select("_id school_name").lean(),
    StudentIptr.find(active).select("_id student_id school_year").lean(),
    DentalChart.find(active).select("_id iptr_id").lean(),
    ToothRecord.find(active).select("chart_id condition").lean(),
    OralHealthCondition.find(active).lean(),
    DietarySocialHabits.find(active).lean(),
    PreventiveCareRecord.find(active).select("_id iptr_id visit_date").lean(),
    RiskStratification.find(active).lean(),
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
    charts: (charts as any[]).map((c) => ({ _id: str(c._id), iptr_id: str(c.iptr_id) })),
    toothRecords: (toothRecords as any[]).map((t) => ({ chart_id: str(t.chart_id), condition: t.condition ?? null })),
    orals: (orals as any[]).map((o) => ({ ...o, iptr_id: str(o.iptr_id) })),
    dietaries: (dietaries as any[]).map((d) => ({ ...d, iptr_id: str(d.iptr_id) })),
    preventives: (preventives as any[]).map((p) => ({
      _id: str(p._id),
      iptr_id: str(p.iptr_id),
      visit_date: p.visit_date ? new Date(p.visit_date).toISOString() : "",
    })),
    risks: (risks as any[]).map((r) => ({
      _id: str(r._id),
      preventive_id: str(r.preventive_id),
      risk_level: r.risk_level,
      recommendation: r.recommendation ?? "",
      dmf_score: Number(r.dmf_score ?? 0),
      validated_by_dentist: r.validated_by_dentist ?? false,
      validated_at: r.validated_at ? new Date(r.validated_at).toISOString() : null,
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
    school: typeof req.query.school === "string" && req.query.school ? req.query.school : "",
    grade: typeof req.query.grade === "string" ? req.query.grade : "all",
    section: typeof req.query.section === "string" ? req.query.section : "all",
    risk: typeof req.query.risk === "string" ? req.query.risk : "all",
    gender: typeof req.query.gender === "string" ? req.query.gender : "all",
    ageGroup: typeof req.query.age_group === "string" ? req.query.age_group : "all",
    sort: req.query.sort === "name" ? "name" : "priority",
    limit: Number(req.query.limit) > 0 ? Number(req.query.limit) : 50,
    offset: Number(req.query.offset) > 0 ? Number(req.query.offset) : 0,
  });

  res.json(page);
}));

// Sprint 144 — one pupil's FULL assessment history, for the detail panel.
// Deliberately its own endpoint rather than a bigger list row: it is read when
// a dentist opens one pupil, which is once per selection, not once per page.
router.get("/stats/risk-history", requireAuth, asyncHandler(async (req, res) => {
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
  const risks = await RiskStratification.find({
    ...active,
    preventive_id: { $in: (preventives as any[]).map((p) => p._id) },
  }).lean();

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
      RiskStratification.find(active).select("preventive_id dmf_score dmf_index risk_level").lean(),
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

router.get("/stats/student-nav", requireAuth, asyncHandler(async (req, res) => {
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
      school: schoolNameById.get(String(s.school_id)) ?? "Unknown School",
    };
  });
  res.json(rows);
}));

router.get("/stats/student-rows", requireAuth, asyncHandler(async (req, res) => {
  // This is the endpoint the Sprint 101 probe caught handing all three
  // schools' students to a school_admin pinned to one.
  const scope = await scopeFilter("Student", req);
  const studentFilter = scope ? { isArchived: false, ...scope } : { isArchived: false };
  const [students, schools, iptrs, charts, preventives, risks] = await Promise.all([
    Student.find(studentFilter),
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
router.use("/student-iptrs", createCrudRouter(StudentIptr, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: ["system_admin", "dentist"], uniqueBy: ["student_id", "school_year"], filterable: ["student_id"] }));
router.use("/medical-histories", createCrudRouter(MedicalHistory, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dietary-social-habits", createCrudRouter(DietarySocialHabits, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/oral-health-conditions", createCrudRouter(OralHealthCondition, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
router.use("/dental-charts", createCrudRouter(DentalChart, { writeRoles: CLINICAL_WRITE_ROLES, filterable: ["iptr_id"] }));
// archiveRoles: a dentist who clears every code off a tooth and saves retires
// that tooth's record -- the chart's own "empty this tooth" action. Before this
// the archive route was ADMIN_ONLY, so the chart could not persist a cleared
// tooth at all and the old codes returned on reload. Restore stays admin-only.
router.use("/tooth-records", createCrudRouter(ToothRecord, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: ["system_admin", "dentist"], filterable: ["chart_id"] }));
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
router.use("/appointments", createCrudRouter(Appointment, { writeRoles: CLINICAL_WRITE_ROLES, archiveRoles: CLINICAL_WRITE_ROLES, dateField: "appointment_datetime" }));
router.use("/dentist-rotations", createCrudRouter(DentistRotation, { writeRoles: CLINICAL_WRITE_ROLES }));

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
router.use("/audit-trails", createCrudRouter(AuditTrail, { readOnly: true, readRoles: ADMIN_ONLY, dateField: "timestamp" }));

export default router;
