// "Every student's IPTR is accessible offline, even if it was never opened."
//
// Part 1, the API: GET /api/offline/bundle (one page of students and everything under
//   them) and /api/offline/version: paging, school scope, roles, archived records
//   excluded, encrypted fields readable, and the version moving only when downloaded
//   data changes (NOT when somebody signs in).
// Part 2, a real browser: a dentist signs in, the background sync downloads every
//   student, the connection is cut, and a chart nobody ever opened still opens.
//
// Needs: the API on :4000 against the SAME database and secrets as below, a Chromium
// (the vite dev server this starts proxies /api to :4000).
//
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... PORT=4000 npx tsx server/local.ts
//   MONGODB_URI=... FIELD_ENCRYPTION_SECRET=... [CHROMIUM_PATH=...] [SHOTS_DIR=...] npx tsx verify_offline_all_students.ts
//
// ⚠ The API rate-limits sign-ins; restart it between runs. Refuses a non-local database.
import "dotenv/config";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { chromium } from "playwright";
import { connectDB } from "./server/config/db.js";
import { School, User, Student, StudentIptr, MedicalHistory, DentalChart, ToothRecord } from "./server/models/index.js";
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
const COUNT = 250; // three pages of 100
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${extra}`}`); };

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
  async login(email: string, password: string) {
    const r = await this.call("POST", "/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.json)}`);
  }
}

const stamp = Date.now();
const tag = String(stamp).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const letters = (n: number) => String(n).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const password = "Str0ng-Test-Pass-9";
await connectDB();

// ── seed: COUNT students in school A, 3 in school B ─────────────────────────
const schoolA = await School.create({ school_name: `Bundle A ${stamp}`, school_type: "Elementary", city: "Taguig", barangay: "Tanyag" });
const schoolB = await School.create({ school_name: `Bundle B ${stamp}`, school_type: "Elementary", city: "Taguig", barangay: "Tanyag" });
const mk = async (role: string, full_name: string, school_ids: unknown[]) =>
  User.create({ role, full_name, email: `${role}.${stamp}.${full_name.replace(/\W/g, "")}@bundle.local`, password_hash: await hashPassword(password), school_ids });
const dentistA = await mk("dentist", "Dr Alpha", [schoolA._id]);
const dentistB = await mk("dentist", "Dr Bravo", [schoolB._id]);
const unscoped = await mk("dentist", "Dr Everywhere", []);
const principal = await mk("school_admin", "Principal", [schoolA._id]);

const base = { birthday: new Date("2015-03-04"), sex: "Male", grade_level: "Grade 3", section: "A", first_name: "Juan" };
const studentsA = await Student.create(Array.from({ length: COUNT }, (_, i) => ({ ...base, school_id: schoolA._id, last_name: `Stu${tag}${letters(i)}` })));
const studentsB = await Student.create(Array.from({ length: 3 }, (_, i) => ({ ...base, school_id: schoolB._id, last_name: `Oth${tag}${letters(i)}` })));
const archivedStudent = await Student.create({ ...base, school_id: schoolA._id, last_name: `Arc${tag}`, isArchived: true });
const iptrs = await StudentIptr.create([...studentsA, ...studentsB].map((s) => ({ student_id: s._id, school_year: "2026-2027", grade_level: "Grade 3", section: "A" })));
const iptrOf = new Map(iptrs.map((i) => [String(i.student_id), i]));
// The first 30 students of A have a chart with three teeth and a medical history.
const charted = studentsA.slice(0, 30);
const charts = await DentalChart.create(charted.map((s) => ({ iptr_id: iptrOf.get(String(s._id))!._id, dentist_id: dentistA._id, date_charted: new Date("2026-09-01") })));
await ToothRecord.create(charts.flatMap((c) => [11, 12, 13].map((n) => ({ chart_id: c._id, tooth_number: n, condition: "Caries" }))));
await ToothRecord.create({ chart_id: charts[0]._id, tooth_number: 14, condition: "Caries", isArchived: true });
await MedicalHistory.create(charted.map((s) => ({ iptr_id: iptrOf.get(String(s._id))!._id, allergies: "Penicillin allergy" })));
await StudentIptr.create({ student_id: studentsA[0]._id, school_year: "2024-2025", isArchived: true });

// ── Part 1: the API ──────────────────────────────────────────────────────────
const sA = new Session(), sB = new Session(), sAll = new Session(), sPrincipal = new Session();
await sA.login(dentistA.email, password);
await sB.login(dentistB.email, password);
await sAll.login(unscoped.email, password);
await sPrincipal.login(principal.email, password);

const walk = async (s: Session, limit?: number) => {
  const pages: any[] = [];
  let after: string | null = null;
  do {
    const r = await s.call("GET", `/offline/bundle?${limit ? `limit=${limit}&` : ""}${after ? `after=${after}` : ""}`);
    if (r.status !== 200) throw new Error(`bundle ${r.status} ${JSON.stringify(r.json)}`);
    pages.push(r.json);
    after = r.json.next;
  } while (after);
  return pages;
};

check("a School Administrator cannot download clinical records", (await sPrincipal.call("GET", "/offline/bundle")).status === 403);
check("nobody signed out can either", (await new Session().call("GET", "/offline/bundle")).status === 401);
check("a malformed cursor is refused", (await sA.call("GET", "/offline/bundle?after=not-an-id")).status === 400);

const pagesA = await walk(sA, 100);
const studentsGot = pagesA.flatMap((p) => p.students);
check("walking the pages returns exactly the school's students, once each", studentsGot.length === COUNT && new Set(studentsGot.map((s: any) => s._id)).size === COUNT, `${studentsGot.length}`);
check("that is three pages, the last one closing the walk", pagesA.length === 3 && pagesA[2].next === null && pagesA[0].next && pagesA[1].next, `${pagesA.length}`);
check("the first page says how many students there are, later ones do not", pagesA[0].total === COUNT && pagesA[1].total === undefined, `${pagesA[0].total}`);
check("students come in a stable order (so a cursor is safe)", studentsGot.every((s: any, i: number, a: any[]) => i === 0 || String(a[i - 1]._id) < String(s._id)));
check("a dentist assigned to school A never receives school B's students", !studentsGot.some((s: any) => String(s.school_id) === String(schoolB._id)));
check("archived students are not sent", !studentsGot.some((s: any) => String(s._id) === String(archivedStudent._id)));
check("names arrive decrypted, as the normal reads send them", studentsGot.every((s: any) => /^Stu/.test(s.last_name)), studentsGot.slice(0, 2).map((s: any) => s.last_name).join(","));

const all = (key: string) => pagesA.flatMap((p) => p[key]);
check("every student's year record comes with them (and the archived one does not)", all("student-iptrs").length === COUNT && !all("student-iptrs").some((i: any) => i.isArchived));
check("charts, teeth and medical histories come too", all("dental-charts").length === 30 && all("medical-histories").length === 30 && all("tooth-records").length === 90, `${all("dental-charts").length}/${all("medical-histories").length}/${all("tooth-records").length}`);
check("an archived tooth record is not sent", !all("tooth-records").some((t: any) => t.tooth_number === 14));
check("encrypted clinical fields arrive readable", all("medical-histories").every((m: any) => m.allergies === "Penicillin allergy"));
const iptrIdsA = new Set(all("student-iptrs").map((i: any) => String(i._id)));
check("every record belongs to a student in the download (nothing from outside)", all("dental-charts").every((c: any) => iptrIdsA.has(String(c.iptr_id))) && all("medical-histories").every((m: any) => iptrIdsA.has(String(m.iptr_id))));

const pagesB = await walk(sB);
check("the other school's dentist gets only that school's students", pagesB.flatMap((p) => p.students).length === 3 && pagesB[0].total === 3);
const pagesAll = await walk(sAll, 200);
check("an unscoped clinician gets every school", pagesAll.flatMap((p) => p.students).length >= COUNT + 3, `${pagesAll.flatMap((p) => p.students).length}`);
const capped = await sAll.call("GET", "/offline/bundle?limit=100000");
check("a huge page size is capped, so one request can never be enormous", capped.status === 200 && capped.json.students.length <= 200, `${capped.json?.students?.length}`);

// The version moves when downloaded data changes, and NOT when somebody signs in.
const v0 = (await sA.call("GET", "/offline/version")).json.at;
await new Session().login(dentistB.email, password);
const v1 = (await sA.call("GET", "/offline/version")).json.at;
check("signing in does not move the version", v1 === v0, `${v0} -> ${v1}`);
await new Promise((r) => setTimeout(r, 20));
await sA.call("PUT", `/students/${studentsA[5]._id}`, { section: "B" });
const v2 = (await sA.call("GET", "/offline/version")).json.at;
check("editing a student moves it", v2 !== v1 && new Date(v2) > new Date(v1), `${v1} -> ${v2}`);
check("a School Administrator cannot read the version either", (await sPrincipal.call("GET", "/offline/version")).status === 403);

// ── Part 2: a real browser ───────────────────────────────────────────────────
const vite = spawn("npx", ["vite", "--port", "5173", "--strictPort"], { stdio: "ignore", shell: process.platform === "win32" });
for (let i = 0; i < 60; i++) { try { if ((await fetch(DEV)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const bundleRequests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/offline/bundle")) bundleRequests.push(r.url()); });

  await page.goto(`${DEV}/login`);
  await page.fill('input[type="email"]', dentistA.email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign In")');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  if (page.url().includes("select-school")) { await page.getByText(schoolA.school_name).first().click(); await page.waitForTimeout(1500); }
  await page.goto(`${DEV}/patients`);
  await page.waitForSelector(`text=/Offline data ready: ${COUNT} students/`, { timeout: 60000 });
  check("signed in, the page reports every student downloaded", true);
  // Three pages of students. The test reloads the page right after signing in, which
  // can interrupt the first download; it then RESUMES from the saved position and
  // repeats at most the one page that was in flight, it does not start over.
  check("it took one request per page of students (a reload mid-way resumes, not restarts)", bundleRequests.length >= 3 && bundleRequests.length <= 4, String(bundleRequests.length));
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/offline-all-students-ready.png` });

  // A student whose chart nobody has opened on this device.
  const neverOpened = charted[12];
  // (A document just created keeps its encrypted text in memory, so the name is rebuilt from the inputs.)
  const neverOpenedName = `Stu${tag}${letters(12)}`;
  await ctx.setOffline(true);
  await page.evaluate((id) => { history.pushState({}, "", `/dental-chart/${id}`); window.dispatchEvent(new PopStateEvent("popstate")); }, String(neverOpened._id));
  await page.waitForTimeout(3000);
  const chartText = await page.evaluate(() => document.body.innerText);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/offline-never-opened-chart.png` });
  if (process.env.DEBUG_TEXT) console.log("CHART TEXT:", chartText.replace(/\n/g, " | ").slice(0, 1500));
  check("OFFLINE, a chart that was never opened still opens, with the student's name", chartText.includes(neverOpenedName), chartText.slice(0, 300).replace(/\n/g, " | "));
  check("and it is not the 'needs a connection' or an error screen", !/needs a connection|Failed to load|not been downloaded/.test(chartText), chartText.slice(0, 200));

  const offlineReads = await page.evaluate(async ([sid, iptrId, chartId]) => {
    const { apiClient } = await import("/src/app/api/client.ts");
    const ys = await apiClient.get<any[]>(`/student-iptrs?student_id=${sid}`);
    const mh = await apiClient.get<any[]>(`/medical-histories?iptr_id=${iptrId}`);
    const teeth = await apiClient.get<any[]>(`/tooth-records?chart_id=${chartId}`);
    return { years: ys.length, allergies: mh[0]?.allergies, teeth: teeth.map((t) => t.tooth_number).sort() };
  }, [String(neverOpened._id), String(iptrOf.get(String(neverOpened._id))!._id), String(charts[12]._id)]);
  check("its year record, medical history and teeth are all there, offline", offlineReads.years === 1 && offlineReads.allergies === "Penicillin allergy" && JSON.stringify(offlineReads.teeth) === "[11,12,13]", JSON.stringify(offlineReads));

  // And the way INTO a chart: the list.
  await page.evaluate(() => { history.pushState({}, "", "/patients"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForTimeout(2500);
  const listText = await page.evaluate(() => document.body.innerText);
  check("OFFLINE, Student Records lists every student, so a chart can be reached", new RegExp(`${COUNT}\\s+STUDENTS`).test(listText), listText.slice(0, 300).replace(/\n/g, " | "));

  // A student created offline sits beside them and is not mistaken for a downloaded one.
  const unknown = await page.evaluate(async () => {
    const { apiClient } = await import("/src/app/api/client.ts");
    return apiClient.get(`/student-iptrs?student_id=${"f".repeat(24)}`).then(() => "answered", () => "refused");
  });
  check("a student that was NOT downloaded is refused, never shown as 'has no records'", unknown === "refused", unknown);
  await ctx.setOffline(false);

  // Signing in again does not download again; changed data does.
  bundleRequests.length = 0;
  await page.reload();
  await page.waitForSelector(`text=/Offline data ready: ${COUNT} students/`, { timeout: 30000 });
  await page.waitForTimeout(2500);
  check("signed in again with nothing changed, nothing is downloaded again", bundleRequests.length === 0, String(bundleRequests.length));
  await sA.call("PUT", `/students/${studentsA[7]._id}`, { section: "C" });
  await page.reload();
  await page.waitForSelector(`text=/Offline data ready: ${COUNT} students/`, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check("after something changed, the next sign-in downloads again", bundleRequests.length === 3, String(bundleRequests.length));

  // Sign-out takes the downloaded records with it.
  const countRecords = () => page.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open("floral-offline");
    open.onsuccess = () => {
      const req = open.result.transaction("records").objectStore("records").count();
      req.onsuccess = () => resolve(req.result);
    };
  }));
  const before = await countRecords();
  await page.getByText("Logout").first().click();
  await page.waitForTimeout(2500);
  const after = await countRecords();
  check("signing out removes every downloaded record from the device", before > COUNT && after === 0, `${before} -> ${after}`);
  await ctx.close();
} finally {
  await browser.close();
  vite.kill();
  await mongoose.disconnect();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
