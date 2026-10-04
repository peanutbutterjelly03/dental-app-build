// Offline sync, SERVER side, against a real API and a real database: held-back edits
// (conflicts), the review/resolve routes, and idempotent creates.
//
// Needs the server running against the SAME database this connects to, with the same
// FIELD_ENCRYPTION_SECRET (it reads the raw collections to prove nothing is stored in
// plaintext). Creates its own schools, users and students; leaves them behind.
//
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... JWT_*=... PORT=4000 npx tsx server/local.ts
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... npx tsx verify_sync_server.ts [http://localhost:4000]
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./server/config/db.js";
import { School, User, Student } from "./server/models/index.js";
import { hashPassword } from "./server/utils/password.js";

// ⚠ This WRITES test users, schools and students. Refuse anything but a local
// database, so it can never be pointed at the real cluster by a stray .env.
{
  const host = (/@?([^/@:?]+)(?::\d+)?\/[^/]*(?:\?|$)/.exec(process.env.MONGODB_URI ?? "") ?? [])[1] ?? "";
  if (!["localhost", "127.0.0.1"].includes(host) && process.env.ALLOW_NON_LOCAL_TEST_DB !== "1") {
    console.error(`Refusing to run: MONGODB_URI host "${host}" is not local. This script creates test data. Use a local database.`);
    process.exit(2);
  }
}

const BASE = process.argv[2] ?? "http://localhost:4000";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${extra}`}`); };

// A tiny cookie jar: one per person, like one browser each.
class Session {
  cookies = new Map<string, string>();
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json };
  }
  async login(email: string, password: string) {
    const r = await this.call("POST", "/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.json)}`);
  }
}

const uid = () => crypto.randomUUID();
const stamp = Date.now();
// Names may not contain digits (the server validates them), so a letters-only tag.
const tag = String(stamp).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const password = "Str0ng-Test-Pass-9";

await connectDB();
const school = await School.create({ school_name: `Sync Test A ${stamp}`, school_type: "Elementary", city: "Taguig", barangay: "Tanyag" });
const otherSchool = await School.create({ school_name: `Sync Test B ${stamp}`, school_type: "Elementary", city: "Taguig", barangay: "Tanyag" });
const mk = async (role: string, name: string, school_ids: unknown[] = []) =>
  User.create({ role, full_name: name, email: `${role}.${stamp}.${name.toLowerCase().replace(/\W/g, "")}@test.local`, password_hash: await hashPassword(password), school_ids });
const dentistUser = await mk("dentist", "Dr Reyes");
const aideUser = await mk("dental_aide", "Aide Santos");
const outsiderUser = await mk("dentist", "Dr Outsider", [otherSchool._id]);
const adminUser = await mk("system_admin", "Admin Boss");
const schoolAdminUser = await mk("school_admin", "Principal", [school._id]);

const dentist = new Session(), aide = new Session(), outsider = new Session(), principal = new Session(), admin = new Session();
await dentist.login(dentistUser.email, password);
await aide.login(aideUser.email, password);
await outsider.login(outsiderUser.email, password);
await principal.login(schoolAdminUser.email, password);
await admin.login(adminUser.email, password);

const newStudent = async (last: string) => {
  const r = await dentist.call("POST", "/students", { school_id: school._id, last_name: last, first_name: "Juan", birthday: "2015-03-04", sex: "Male", grade_level: "Grade 3", section: "A" });
  if (r.status !== 201) throw new Error(`student create ${r.status} ${JSON.stringify(r.json)}`);
  return r.json._id as string;
};

// ── 1. A normal offline edit applies, and the envelope is never stored ───────
const s1 = await newStudent(`Alpha${tag}`);
const op1 = uid();
let r = await dentist.call("PUT", `/students/${s1}`, { section: "B", _sync: { operationId: op1, base: { section: "A" } } });
check("an offline edit nobody else touched is applied", r.status === 200 && r.json.section === "B", JSON.stringify(r));
const raw1 = await mongoose.connection.collection("students").findOne({ _id: new mongoose.Types.ObjectId(s1) });
check("the _sync envelope is never stored on the record", raw1 && !("_sync" in raw1), JSON.stringify(Object.keys(raw1 ?? {})));
r = await dentist.call("PUT", `/students/${s1}`, { section: "B", _sync: { operationId: op1, base: { section: "A" } } });
check("replaying an edit that already applied is harmless", r.status === 200 && r.json.section === "B", JSON.stringify(r));

// ── 2. A clash is held back, not applied, not lost ───────────────────────────
const s2 = await newStudent(`Bravo${tag}`);
await aide.call("PUT", `/students/${s2}`, { section: "C" }); // someone else edits online meanwhile
const op2 = uid();
r = await dentist.call("PUT", `/students/${s2}`, { section: "B", grade_level: "Grade 3", _sync: { operationId: op2, base: { section: "A", grade_level: "Grade 3" } } });
check("an edit over a field someone else changed answers 409 with conflict:true", r.status === 409 && r.json?.conflict === true, JSON.stringify(r));
check("it names the clashing field and returns the server's current record", JSON.stringify(r.json?.fields) === JSON.stringify(["section"]) && r.json?.current?.section === "C", JSON.stringify(r.json));
const conflictId = r.json?.conflictId as string;
check("the record was NOT overwritten", (await dentist.call("GET", `/students/${s2}`)).json.section === "C");
r = await dentist.call("PUT", `/students/${s2}`, { section: "B", grade_level: "Grade 3", _sync: { operationId: op2, base: { section: "A", grade_level: "Grade 3" } } });
check("a retry of the same change finds its own conflict (no second row)", r.status === 409 && r.json?.conflictId === conflictId, JSON.stringify(r.json));

// ── 3. Several people's offline edits accumulate on one record ───────────────
const op3 = uid();
r = await aide.call("PUT", `/students/${s2}`, { section: "D", _sync: { operationId: op3, base: { section: "A" } } });
check("a second person's clashing offline edit is held too", r.status === 409 && r.json?.conflictId && r.json.conflictId !== conflictId, JSON.stringify(r.json));
const aideConflictId = r.json?.conflictId as string;
r = await dentist.call("GET", `/sync-conflicts/record/Student/${s2}`);
check("the review lists both edits, who made them, and the live server record", r.status === 200 && r.json.candidates.length === 2 && r.json.current.section === "C", JSON.stringify(r.json));
const byOwner = Object.fromEntries((r.json?.candidates ?? []).map((c: any) => [c.owner.name, c]));
check("each edit shows its owner, the values they started from and what they wanted", byOwner["Dr Reyes"]?.changes?.section === "B" && byOwner["Dr Reyes"]?.base?.section === "A" && byOwner["Aide Santos"]?.changes?.section === "D", JSON.stringify(r.json?.candidates));

const rows = await mongoose.connection.collection("syncconflicts").find({ record_id: new mongoose.Types.ObjectId(s2) }).toArray();
check("held edits are encrypted at rest, not stored as readable JSON", rows.length === 2 && rows.every((row) => typeof row.changes_json === "string" && !row.changes_json.includes("section") && /^[0-9a-f]+:[0-9a-f]+$/i.test(row.changes_json)), JSON.stringify(rows.map((x) => String(x.changes_json).slice(0, 40))));

// ── 4. Who may review ────────────────────────────────────────────────────────
check("the School Administrator cannot reach it", (await principal.call("GET", `/sync-conflicts/record/Student/${s2}`)).status === 403);
check("a clinician outside the record's school cannot see it (404)", (await outsider.call("GET", `/sync-conflicts/record/Student/${s2}`)).status === 404);
check("a clinician outside the school cannot resolve it either (404)", (await outsider.call("POST", `/sync-conflicts/${conflictId}/resolve`, { action: "apply" })).status === 404);
check("an unknown resource is refused", (await dentist.call("GET", `/sync-conflicts/record/Users/${s2}`)).status === 400);
check("a bad action is refused", (await dentist.call("POST", `/sync-conflicts/${conflictId}/resolve`, { action: "delete" })).status === 400);

// ── 5. Resolving ─────────────────────────────────────────────────────────────
r = await dentist.call("POST", `/sync-conflicts/${conflictId}/resolve`, { action: "apply" });
check("choosing an offline version writes it onto the record", r.status === 200 && r.json.status === "applied" && r.json.record.section === "B", JSON.stringify(r.json));
check("the record really holds it", (await dentist.call("GET", `/students/${s2}`)).json.section === "B");
r = await aide.call("POST", `/sync-conflicts/${aideConflictId}/resolve`, { action: "apply" });
check("the other edit was superseded, so applying it now is refused", r.status === 409 && r.json.status === "discarded", JSON.stringify(r));
r = await dentist.call("POST", `/sync-conflicts/${conflictId}/resolve`, { action: "apply" });
check("resolving twice is refused, not repeated", r.status === 409 && r.json.status === "applied", JSON.stringify(r));
r = await dentist.call("GET", `/sync-conflicts/record/Student/${s2}`);
check("nothing is left pending on the record", r.json.candidates.length === 0, JSON.stringify(r.json));

const s3 = await newStudent(`Charlie${tag}`);
await aide.call("PUT", `/students/${s3}`, { section: "C" });
const clash = await dentist.call("PUT", `/students/${s3}`, { section: "B", _sync: { operationId: uid(), base: { section: "A" } } });
r = await dentist.call("POST", `/sync-conflicts/${clash.json.conflictId}/resolve`, { action: "discard" });
check("choosing the server version leaves the record as it is", r.status === 200 && r.json.status === "discarded" && (await dentist.call("GET", `/students/${s3}`)).json.section === "C", JSON.stringify(r.json));

// ── 6. Audit trail ───────────────────────────────────────────────────────────
const audit = await mongoose.connection.collection("audittrails").find({ affected_record_id: new mongoose.Types.ObjectId(s2) }).toArray();
const actions = audit.map((a) => String(a.action));
check("holding and resolving are in the audit trail", actions.some((a) => /Held an offline edit/.test(a)) && actions.some((a) => /kept the offline edit/.test(a)), actions.join(" | "));

// ── 7. Ordinary saves are untouched ──────────────────────────────────────────
const s4 = await newStudent(`Delta${tag}`);
r = await dentist.call("PUT", `/students/${s4}`, { section: "E" });
check("a normal save with no envelope works exactly as before", r.status === 200 && r.json.section === "E");
r = await dentist.call("PUT", `/students/${s4}`, { section: "F", address: "New St", _sync: { operationId: uid(), base: { section: "E" } } });
check("a field with no starting value is never called a conflict", r.status === 200 && r.json.address === "New St", JSON.stringify(r));
r = await dentist.call("PUT", `/students/${s4}`, { section: "G", _sync: "nonsense" });
check("a malformed envelope does not break the save", r.status === 200 && r.json.section === "G", JSON.stringify(r));
r = await dentist.call("PUT", `/students/${s4}`, { birthday: "2015-03-04", _sync: { operationId: uid(), base: { birthday: "2015-03-04" } } });
check("dates compare by value (date-only vs full timestamp is not a conflict)", r.status === 200, JSON.stringify(r));

// ── 8. A create applies once ─────────────────────────────────────────────────
const createOp = uid();
const body = { school_id: school._id, last_name: `Echo${tag}`, first_name: "Eli", birthday: "2014-01-01", sex: "Male", grade_level: "Grade 4", section: "A", _sync: { operationId: createOp, base: {} } };
r = await dentist.call("POST", "/students", body);
const firstId = r.json?._id;
check("a queued create is saved", r.status === 201 && firstId, JSON.stringify(r));
r = await dentist.call("POST", "/students", body);
check("the same change arriving again is answered with the record that exists", r.status === 200 && r.json._id === firstId, JSON.stringify(r));
const count = (await Student.find({ isArchived: false })).filter((s: any) => s.last_name === `Echo${tag}`).length;
check("so the student exists exactly once", count === 1, String(count));
r = await aide.call("POST", "/students", body);
check("another user quoting that id does not get that record", !(r.status === 200 && r.json?._id === firstId), JSON.stringify(r));

const raceOp = uid();
const raceBody = { school_id: school._id, last_name: `Foxtrot${tag}`, first_name: "Fe", birthday: "2014-02-02", sex: "Female", grade_level: "Grade 4", section: "A", _sync: { operationId: raceOp, base: {} } };
const race = await Promise.all([dentist.call("POST", "/students", raceBody), dentist.call("POST", "/students", raceBody), dentist.call("POST", "/students", raceBody)]);
const raceCount = (await Student.find({ isArchived: false })).filter((s: any) => s.last_name === `Foxtrot${tag}`).length;
check("three simultaneous arrivals of one change create it once", raceCount === 1, `${raceCount} statuses=${race.map((x) => x.status).join(",")}`);

const failOp = uid();
r = await dentist.call("POST", "/students", { school_id: school._id, last_name: "", first_name: "Bad", birthday: "2014-03-03", sex: "Male", _sync: { operationId: failOp, base: {} } });
check("an invalid create is refused", r.status === 400, JSON.stringify(r));
r = await dentist.call("POST", "/students", { school_id: school._id, last_name: `Golf${tag}`, first_name: "Gil", birthday: "2014-03-03", sex: "Male", grade_level: "Grade 4", section: "A", _sync: { operationId: failOp, base: {} } });
check("a refused create does not block the same change once corrected", r.status === 201, JSON.stringify(r));

// ── 9. Archived records are still out of reach ───────────────────────────────
const s5 = await newStudent(`Hotel${tag}`);
const archived = await admin.call("PATCH", `/students/${s5}/archive`);
check("(setup) the record is archived", archived.status === 200, JSON.stringify(archived));
r = await dentist.call("PUT", `/students/${s5}`, { section: "B", _sync: { operationId: uid(), base: { section: "A" } } });
check("an edit to an archived record is still refused", r.status === 404, JSON.stringify(r));

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
