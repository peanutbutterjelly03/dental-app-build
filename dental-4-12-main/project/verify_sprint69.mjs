// Sprint 69 — adding a student opens that school year's record.
//
// Adding a student created NO StudentIptr. The year record only appeared when
// someone later opened the chart and clicked "Add Year", so a freshly encoded
// student had nowhere to hang a medical history, a charting or an RPC visit,
// and appeared in no year-scoped report until a second manual step happened.
//
// This is also the prerequisite for capturing the IPTR's checkbox sections at
// intake (the thing the Base44 prototype does): there was literally no record
// to write them to.
//
// Usage: node verify_sprint69.mjs [baseUrl] [apiBase]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000';
const LAST = `ZZTest${Date.now()}`;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const sy = (d = new Date()) => (d.getMonth() <= 3 ? `${d.getFullYear() - 1}-${d.getFullYear()}` : `${d.getFullYear()}-${d.getFullYear() + 1}`);

const run = async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  console.log(`\nSprint 69 verification against ${BASE}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);
  await page.click('button:has-text("Add Student")');
  await page.waitForTimeout(1500);

  const modal = page.locator('dialog, [role="dialog"]').first();
  const set = async (label, value) => {
    const f = modal.locator(`label:has-text("${label}")`).first().locator('xpath=following-sibling::*[1]');
    await f.fill(value).catch(async () => { await f.selectOption(value); });
  };
  // Every field the form now requires (Sprint 62).
  await modal.locator('input').nth(0).fill(LAST);           // Last Name
  await modal.locator('input').nth(1).fill('Intake');       // First Name
  await set('Birthdate', '2015-06-01');
  await set('Gender', 'Male');
  await set('School', 'Bagong Tanyag Integrated School');
  await set('Grade', 'Grade 4');
  await set('Section', 'Sampaguita');
  await set('Contact Number', '09171234567');
  await set('Guardian Name', 'Test Guardian');
  await set('Guardian Contact', '09171234567');
  await set('Address', '1 Test St');
  await page.waitForTimeout(500);
  await modal.locator('button:has-text("Add Student")').last().click();
  await page.waitForTimeout(4000);

  const toast = await page.locator('[role="status"], [role="alert"]').first().innerText().catch(() => '');
  console.log(`  toast: ${toast.replace(/\s+/g, ' ').slice(0, 140)}`);
  check('the save succeeded', toast.includes('Student added'), toast.slice(0, 120));
  check('the toast says the year record was opened', toast.includes(sy()), toast.slice(0, 140));

  // The point of the sprint, checked against the database rather than the toast.
  const students = (await api('/students')).body;
  const student = students.find((s) => s.last_name === LAST);
  check('the student exists', !!student);

  const iptrs = (await api(`/student-iptrs?student_id=${student._id}`)).body;
  check('a school-year record was created with the student', iptrs.length === 1, `${iptrs.length} records`);
  check('it is THIS school year', iptrs[0]?.school_year === sy(), `${iptrs[0]?.school_year} vs ${sy()}`);
  // 57a: the IPTR carries the grade, so the year is truthful from birth.
  check('grade and section are stamped on it (57a)',
    iptrs[0]?.grade_level === 'Grade 4' && iptrs[0]?.section === 'Sampaguita',
    JSON.stringify({ g: iptrs[0]?.grade_level, s: iptrs[0]?.section }));

  // And it is immediately usable — a medical history can be attached, which
  // was impossible before because no IPTR existed.
  const mh = await api('/medical-histories', {
    method: 'POST', body: JSON.stringify({ iptr_id: iptrs[0]._id, allergies: '', hypertension: true }),
  });
  check('a medical history can be attached straight away', mh.status === 201, `got ${mh.status}`);

  await browser.close();

  // Clean up: archive what we made, never delete.
  //
  // As ADMIN — archiving a STUDENT is admin-only (crudFactory's archiveRoles
  // default), while student-iptrs also allows the dentist. Cleaning up on the
  // dentist session left a test student in the database once; do not repeat it.
  const adminLogin = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
  });
  cookie = (adminLogin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (mh.body?._id) await api(`/medical-histories/${mh.body._id}/archive`, { method: 'PATCH' });
  await api(`/student-iptrs/${iptrs[0]._id}/archive`, { method: 'PATCH' });
  const archived = await api(`/students/${student._id}/archive`, { method: 'PATCH' });
  check('cleanup archives the test student (admin-only action)', archived.status === 200, `got ${archived.status}`);
  const left = (await api('/students')).body.some((s) => s.last_name === LAST);
  check('the test student is archived out of the active list', !left);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
