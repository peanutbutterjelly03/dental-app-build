// Sprint 60 — schools come from the database, and admin can register them.
//
// Every school dropdown was a hardcoded array repeated in four components, so
// adding a school meant editing code and a school created through the API
// appeared in no form. By CLAUDE.md's rule that is a cosmetic control: it looks
// like the system's school list and is actually a constant.
//
// The real test is end-to-end: add a school as admin, then confirm it shows up
// in a form that had the constant. Cleans up after itself (archives the school
// it created) so the demo data is unchanged.
//
// Usage: node verify_sprint60.mjs [baseUrl] [apiBase]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000';
const MARKER = `ZZ Test School ${Date.now()}`;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const run = async () => {
  // Admin, because school writes are ADMIN_ONLY.
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set in .env');
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  console.log(`\nSprint 60 verification against ${BASE}\n`);

  const before = (await api('/schools')).body;
  console.log(`  ${before.length} school(s) before`);

  // A non-admin must not be able to create one.
  const dentist = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  const dentistCookie = (dentist.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const denied = await fetch(`${API}/api/schools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: dentistCookie },
    body: JSON.stringify({ school_name: 'Should Not Exist', school_type: 'Elementary School', principal_name: 'x', street_address: 'x', barangay: 'x', city: 'x' }),
  });
  check('a dentist cannot create a school (admin only)', denied.status === 403, `got ${denied.status}`);

  // Create as admin.
  const created = await api('/schools', {
    method: 'POST',
    body: JSON.stringify({
      school_name: MARKER, school_type: 'Elementary School', principal_name: 'Test Principal',
      street_address: '1 Test St', barangay: 'Tanyag', city: 'Taguig City',
    }),
  });
  check('admin can create a school', created.status === 201, `got ${created.status}`);
  const newId = created.body?._id;

  const after = (await api('/schools')).body;
  check('the new school is in the list', after.some((s) => s.school_name === MARKER), `${after.length} schools`);
  check('the model kept every required field',
    after.find((s) => s.school_name === MARKER)?.principal_name === 'Test Principal');

  // ── The point of the sprint: does a FORM see it? ─────────────────────────
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for something that only exists AFTER sign-in. 'nav, aside' used to
  // work, but the split login (Sprint 61) put an <aside> on the login page
  // itself, so that selector matched instantly and the script carried on
  // unauthenticated.
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);
  await page.click('button:has-text("Add Student")');
  await page.waitForTimeout(1500);
  const opts = await page.locator('select').filter({ hasText: 'Select School' }).first().locator('option').allTextContents();
  check('the Add Student form offers the new school', opts.includes(MARKER), JSON.stringify(opts));

  // And the DOH report's school filter, which had its own constant.
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(3500);
  const reportOpts = await page.locator('#doh-school option').allTextContents();
  check('the DOH report filter offers the new school', reportOpts.some((o) => o.includes('ZZ Test School')), JSON.stringify(reportOpts));

  await browser.close();

  // ── Clean up: archive, never delete ──────────────────────────────────────
  if (newId) {
    const archived = await api(`/schools/${newId}/archive`, { method: 'PATCH' });
    check('the test school archives cleanly', archived.status === 200, `got ${archived.status}`);
    const finalList = (await api('/schools')).body;
    check('an archived school leaves the dropdown list', !finalList.some((s) => s.school_name === MARKER));
    check('school count is back to where it started', finalList.length === before.length,
      `${finalList.length} vs ${before.length}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
