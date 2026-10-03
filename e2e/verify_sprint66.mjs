// Sprint 66 — the archive UI (backlog 27).
//
// CLAUDE.md lists "restore archived records" as a System Admin capability and
// the API has supported it since Sprint 6, but nothing in the app could VIEW an
// archived record, let alone restore one: `includeArchived` appeared nowhere in
// src/app. An archived school year was invisible from inside the app and
// recoverable only by a direct database query.
//
// Round-trips a real record: create → archive → confirm it leaves the normal
// lists and appears in the archive screen → restore through the UI → confirm it
// is back. Cleans up after itself.
//
// Usage: node verify_sprint66.mjs [baseUrl] [apiBase]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000';
const MARKER = `ZZ Archive Test ${Date.now()}`;
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

const run = async () => {
  const email = process.env.SEED_ADMIN_EMAIL, password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_* not set in .env');
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  console.log(`\nSprint 66 verification against ${BASE}\n`);

  // A school is the cleanest thing to round-trip: admin owns it end to end.
  const created = await api('/schools', {
    method: 'POST',
    body: JSON.stringify({
      school_name: MARKER, school_type: 'Elementary School', principal_name: 'T',
      street_address: '1 T St', barangay: 'Tanyag', city: 'Taguig City',
    }),
  });
  const id = created.body?._id;
  check('created a school to archive', created.status === 201, `got ${created.status}`);

  await api(`/schools/${id}/archive`, { method: 'PATCH' });
  const active = (await api('/schools')).body;
  check('archived record leaves the normal list', !active.some((s) => s._id === id));

  // A non-admin must not be able to see archived records at all.
  const dentist = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  const dCookie = (dentist.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const denied = await fetch(`${API}/api/schools?includeArchived=true`, { headers: { cookie: dCookie } });
  check('a dentist cannot list archived records', denied.status === 403, `got ${denied.status}`);

  // ── The UI ───────────────────────────────────────────────────────────────
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  if (page.url().includes('/select-school')) {
    await page.locator('button, [role="button"]').filter({ hasText: 'Bagong Tanyag' }).first().click();
    await page.waitForTimeout(4000);
  }

  const navLinks = await page.locator('nav a, aside a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  check('admin nav offers Archived Records', navLinks.includes('/archive'), JSON.stringify(navLinks));

  await page.goto(`${BASE}/archive`);
  await page.waitForTimeout(3500);
  await page.locator('#archive-kind').selectOption('schools');
  await page.waitForTimeout(3000);

  let body = await page.locator('tbody').innerText();
  check('the archived record is listed', body.includes(MARKER), body.slice(0, 160));
  // The critical one: includeArchived=true returns archived AND active, so a
  // naive screen would list every school with a Restore button.
  const activeNames = active.map((s) => s.school_name);
  check('ACTIVE records are not listed as archived',
    !activeNames.some((n) => body.includes(n)), `leaked: ${activeNames.filter((n) => body.includes(n)).join(', ')}`);

  // Restore through the UI.
  const row = page.locator('tr', { hasText: MARKER });
  await row.locator('button:has-text("Restore")').click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Restore")').last().click();
  await page.waitForTimeout(3500);

  body = await page.locator('tbody').innerText();
  check('it leaves the archive list after restoring', !body.includes(MARKER), body.slice(0, 160));

  const afterRestore = (await api('/schools')).body;
  check('it is back in the normal list', afterRestore.some((s) => s._id === id));
  const restored = afterRestore.find((s) => s._id === id);
  check('restore cleared archivedAt / archivedBy',
    !restored?.archivedAt && !restored?.archivedBy, JSON.stringify({ at: restored?.archivedAt, by: restored?.archivedBy }));

  await browser.close();

  // Clean up: archive it again so demo data is unchanged.
  await api(`/schools/${id}/archive`, { method: 'PATCH' });
  const final = (await api('/schools')).body;
  check('cleanup left the active school list unchanged', final.length === active.length, `${final.length} vs ${active.length}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
