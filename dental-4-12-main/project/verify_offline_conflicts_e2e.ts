// Offline conflicts, the whole stack: a real browser, the real API, a real database,
// two real people. A dentist edits three students OFFLINE; an aide changes the same
// records meanwhile; the dentist comes back online and settles each one through the
// real review pop-up.
//
//   A  "Use my version"                -> the dentist's edit becomes the record
//   B  "Use Aide Santos's version"     -> the aide's waiting offline edit becomes the record
//   C  settled by the aide meanwhile   -> the pop-up says so and clears it
//
// Needs: the API running on :4000 against the SAME database and secrets as below
// (the vite dev server this starts proxies /api to :4000), and a Chromium.
//
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... PORT=4000 npx tsx server/local.ts
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... [CHROMIUM_PATH=...] [SHOTS_DIR=...] npx tsx verify_offline_conflicts_e2e.ts
//
// ⚠ The API rate-limits sign-ins. This makes several; restart the API between runs.
import "dotenv/config";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { chromium } from "playwright";
import { connectDB } from "./server/config/db.js";
import { School, User } from "./server/models/index.js";
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

const DEV = "http://localhost:5173";
const API = "http://localhost:4000/api";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${extra}`}`); };

// A person on the API, outside any browser (the aide, and test setup).
class Session {
  cookies = new Map<string, string>();
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
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
}

const stamp = Date.now();
const tag = String(stamp).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const password = "Str0ng-Test-Pass-9";
await connectDB();
const school = await School.create({ school_name: `E2E School ${stamp}`, school_type: "Elementary", city: "Taguig", barangay: "Tanyag" });
const mk = async (role: string, full_name: string) =>
  User.create({ role, full_name, email: `${role}.${stamp}@e2e.local`, password_hash: await hashPassword(password), school_ids: [school._id] });
const dentistUser = await mk("dentist", "Dr Reyes");
const aideUser = await mk("dental_aide", "Aide Santos");

const aide = new Session();
const login = await aide.call("POST", "/auth/login", { email: aideUser.email, password });
if (login.status !== 200) throw new Error(`aide login ${login.status} ${JSON.stringify(login.json)}`);
const setup = new Session();
await setup.call("POST", "/auth/login", { email: dentistUser.email, password });
const mkStudent = async (last: string) => {
  const r = await setup.call("POST", "/students", { school_id: school._id, last_name: `${last}${tag}`, first_name: "Juan", birthday: "2015-03-04", sex: "Male", grade_level: "Grade 3", section: "A" });
  if (r.status !== 201) throw new Error(`student ${r.status} ${JSON.stringify(r.json)}`);
  return r.json._id as string;
};
const A = await mkStudent("Aaa"), B = await mkStudent("Bbb"), C = await mkStudent("Ccc");
const sectionOf = async (id: string) => (await aide.call("GET", `/students/${id}`)).json?.section;

const vite = spawn("npx", ["vite", "--port", "5173", "--strictPort"], { stdio: "ignore", shell: process.platform === "win32" });
for (let i = 0; i < 60; i++) { try { if ((await fetch(DEV)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();

  // The dentist signs in the way a person does.
  await page.goto(`${DEV}/login`);
  await page.fill('input[type="email"]', dentistUser.email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign In")');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  if (page.url().includes("select-school")) {
    await page.getByText(school.school_name).first().click();
    await page.waitForTimeout(1500);
  }
  await page.goto(`${DEV}/dental-chart/${A}`);
  await page.waitForTimeout(2500);
  check("the dentist is signed in and the chart opens", (await page.evaluate(() => document.body.innerText)).includes(`Aaa${tag}`));

  await page.evaluate(async () => {
    window.__m = { ...(await import("/src/app/api/client.ts")), ...(await import("/src/app/offline/db.ts")) };
  });
  // Opening each record online is what saves the copy an offline edit is later compared with.
  await page.evaluate(async (ids) => { for (const id of ids) await (window as any).__m.apiClient.get(`/students/${id}`); }, [A, B, C]);
  await page.waitForTimeout(600);

  // ── offline: the dentist edits all three ──────────────────────────────────
  await ctx.setOffline(true);
  await page.evaluate(async (ids) => { for (const id of ids) await (window as any).__m.apiClient.put(`/students/${id}`, { section: "B" }); }, [A, B, C]);
  check("offline, the three edits are queued on the device", (await page.evaluate(async () => (await (window as any).__m.getQueue()).length)) === 3);

  // ── meanwhile, the aide changes the same records (online) ─────────────────
  for (const id of [A, B, C]) await aide.call("PUT", `/students/${id}`, { section: "C" });
  // ... and the aide's OWN offline edits to B and C arrive at the server (held, like any clash).
  const heldB = await aide.call("PUT", `/students/${B}`, { section: "D", _sync: { operationId: crypto.randomUUID(), base: { section: "A" } } });
  const heldC = await aide.call("PUT", `/students/${C}`, { section: "D", _sync: { operationId: crypto.randomUUID(), base: { section: "A" } } });
  check("the aide's own offline edits are held by the server too", heldB.status === 409 && heldC.status === 409, `${heldB.status} ${heldC.status}`);

  // ── the dentist reconnects ────────────────────────────────────────────────
  await ctx.setOffline(false);
  await page.waitForSelector("dialog[open]", { timeout: 15000 });
  const summary = await page.locator("dialog[open]").innerText();
  check("coming back online, the summary opens and offers a review", /Review changes/.test(summary) && /Needs review/.test(summary), summary);
  check("none of the three edits overwrote anything", (await sectionOf(A)) === "C" && (await sectionOf(B)) === "C" && (await sectionOf(C)) === "C");
  const queued = await page.evaluate(async () => (await (window as any).__m.getQueue()).map((w: any) => ({ s: w.status, c: !!w.serverConflictId })));
  check("each is held with the server's conflict id", queued.length === 3 && queued.every((q: any) => q.s === "conflict" && q.c), JSON.stringify(queued));

  // The aide settles C before the dentist has looked: her version is applied.
  const aideResolvesC = await aide.call("POST", `/sync-conflicts/${heldC.json.conflictId}/resolve`, { action: "apply" });
  check("(setup) the aide settles record C herself", aideResolvesC.status === 200, JSON.stringify(aideResolvesC));

  await page.getByRole("button", { name: "Review changes" }).click();
  await page.waitForTimeout(1500);
  const review = await page.locator("dialog[open]").innerText();
  check("the review lists the three records", (review.match(/Student record updated/g) ?? []).length === 3, review);
  check("it shows the dentist's version beside the server's, from the real record", /Your version/.test(review) && /Server version/.test(review) && /Started from: A/.test(review), review);
  check("it lists the aide's waiting version of record B, by name", /Also waiting on this record: Aide Santos/.test(review), review);
  check("it recognises that record C was already settled", /already settled this record/.test(review), review);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/offline-conflict-e2e.png` });

  // A: use my version
  await page.getByRole("button", { name: "Use my version" }).first().click();
  await page.getByRole("button", { name: "Yes, use my version" }).click();
  await page.waitForTimeout(1500);
  check("A: \"Use my version\" makes the dentist's edit the record", (await sectionOf(A)) === "B", String(await sectionOf(A)));

  // B: use the aide's version
  await page.getByRole("button", { name: "Use Aide Santos's version" }).click();
  await page.getByRole("button", { name: "Yes, use Aide Santos's version" }).click();
  await page.waitForTimeout(1500);
  check("B: using the aide's version makes HER edit the record", (await sectionOf(B)) === "D", String(await sectionOf(B)));

  // C: settled elsewhere
  await page.getByRole("button", { name: "Clear this from my list" }).click();
  await page.waitForTimeout(1200);
  check("C: the aide's choice stands, and the dentist's copy is cleared", (await sectionOf(C)) === "D", String(await sectionOf(C)));
  check("the queue is empty and the pop-up has closed itself", (await page.evaluate(async () => (await (window as any).__m.getQueue()).length)) === 0 && (await page.locator("dialog[open]").count()) === 0);

  // ── what the database recorded ────────────────────────────────────────────
  const rows = await mongoose.connection.collection("syncconflicts").find({ record_id: { $in: [A, B, C].map((id) => new mongoose.Types.ObjectId(id)) } }).toArray();
  const stat = (rid: string, owner: any) => rows.filter((r) => String(r.record_id) === rid && String(r.owner_id) === String(owner._id)).map((r) => r.status).join(",");
  check("A: the dentist's edit is recorded as applied", stat(A, dentistUser) === "applied", stat(A, dentistUser));
  check("B: the dentist's edit is superseded, the aide's applied", stat(B, dentistUser) === "discarded" && stat(B, aideUser) === "applied", `${stat(B, dentistUser)} / ${stat(B, aideUser)}`);
  check("C: the dentist's edit is superseded, the aide's applied", stat(C, dentistUser) === "discarded" && stat(C, aideUser) === "applied", `${stat(C, dentistUser)} / ${stat(C, aideUser)}`);
  const audit = await mongoose.connection.collection("audittrails").find({ affected_record_id: new mongoose.Types.ObjectId(A) }).toArray();
  check("the choices are in the audit trail", audit.some((a) => /kept the offline edit/.test(String(a.action))), audit.map((a) => a.action).join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  vite.kill();
  await mongoose.disconnect();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
