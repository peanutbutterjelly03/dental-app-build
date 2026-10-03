// Sprint 81 — the UI half: the Record button, the modal, and the FHSIS
// sub-rows. The API contract is covered by verify_sprint81.mjs; this asserts
// the parts that only break in a browser.
//
// ⚠ Writes to the shared database, then ARCHIVES what it created (never hard
// deletes). Cleanup runs even when an assertion fails.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000/api';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const login = async (email, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
};

const before = new Set();
let adminJar = null;

const cleanup = async () => {
  if (!adminJar) return;
  const r = await fetch(`${API}/preventive-care-records`, { headers: { Cookie: adminJar } });
  const now = await r.json();
  const fresh = now.filter((p) => !before.has(p._id));
  for (const p of fresh) {
    await fetch(`${API}/preventive-care-records/${p._id}/archive`, { method: 'PATCH', headers: { Cookie: adminJar } });
  }
  console.log(`\ncleanup: archived ${fresh.length} record(s) created by this run`);
};

const run = async () => {
  adminJar = await login(process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com', process.env.SEED_ADMIN_PASSWORD);
  const existing = await (await fetch(`${API}/preventive-care-records`, { headers: { Cookie: adminJar } })).json();
  for (const p of existing) before.add(p._id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log(`\nSprint 81 UI verification against ${BASE}\n`);

  // ── Dentist sees and can use the control ─────────────────────────────────
  await page.goto(BASE);
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/rpc`);
  await page.waitForTimeout(3500);

  const head = await page.innerText('table thead');
  check('the Record column header is present for a dentist', /Record/.test(head), head.replace(/\s+/g, ' '));

  const btn = page.locator('table tbody button', { hasText: /^Visit [12]$/ }).first();
  const haveBtn = await btn.count() > 0;
  check('at least one row offers a Record button', haveBtn);
  if (!haveBtn) { await browser.close(); return; }

  // The row navigates to the dental chart; the button must not.
  await btn.click();
  await page.waitForTimeout(900);
  check('clicking Record does NOT navigate away (stopPropagation works)',
    page.url().includes('/rpc'), page.url());

  const dialog = page.locator('dialog');
  check('the modal opens', await dialog.count() > 0);

  const dlgText = await dialog.innerText();
  check('the modal names the visit number', /Record Visit [12]/.test(dlgText));
  check('the facility question offers THREE states, not a checkbox',
    dlgText.includes('Facility-based') && dlgText.includes('Non-facility-based') && dlgText.includes('Not recorded'));

  const dateVal = await page.inputValue('#rpc-visit-date');
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  check('visit date defaults to TODAY in local time (not UTC-shifted)', dateVal === iso, `got ${dateVal}, expected ${iso}`);

  // ── The date decides the school year, and the guard blocks a mismatch ────
  // The demo DB has 26 IPTRs on 2025-2026 and 2 on 2026-2027, so for most
  // students today's date resolves to a school year they have no record for.
  // That must BLOCK rather than file the visit against another year.
  const saveBtn = page.locator('dialog button:has-text("Record visit")');
  const blockedToday = await saveBtn.isDisabled();
  if (blockedToday) {
    check('save is BLOCKED when the date lands in a school year with no IPTR', true);
    check('the modal says which school year is missing', /no IPTR for/i.test(await dialog.innerText()));
  }

  // Move the date into 2025-2026 (March 2026), which the demo data does have.
  await page.fill('#rpc-visit-date', '2026-03-02');
  await page.waitForTimeout(400);
  const dlgAfterDate = await dialog.innerText();
  check('changing the date re-resolves the school year', /2025-2026/.test(dlgAfterDate), dlgAfterDate.replace(/\s+/g, ' ').slice(0, 200));
  check('save is ENABLED once the date matches an existing IPTR', !(await saveBtn.isDisabled()));

  // ── Save with an explicit facility flag ──────────────────────────────────
  await page.click('dialog button:has-text("Facility-based")');
  await saveBtn.click();
  await page.waitForTimeout(3000);

  check('the modal closes after saving', await page.locator('dialog').count() === 0);
  const body = await page.innerText('body');
  check('a toast confirms the save', /recorded for/i.test(body));

  const after = await (await fetch(`${API}/preventive-care-records`, { headers: { Cookie: adminJar } })).json();
  const fresh = after.filter((p) => !before.has(p._id));
  check('exactly one new record reached the database', fresh.length === 1, `${fresh.length} created`);
  check('it carries facility_based = true from the UI', fresh[0]?.facility_based === true, JSON.stringify(fresh[0]?.facility_based));

  // ── The list reflects it without a manual refresh ────────────────────────
  // The status filter defaults to 'outstanding', so recording the SECOND visit
  // correctly drops the row out of view — this page is a worklist (Sprint 51).
  // Widen to all statuses first, otherwise this asserts the opposite of the
  // intended behaviour.
  await page.locator('select:has(option[value="outstanding"])').selectOption('all');
  await page.waitForTimeout(600);
  const reloaded = await page.innerText('table tbody');
  check('the saved visit date appears in the list (reload() ran, no manual refresh)',
    reloaded.includes('2026-03-02'), 'list did not refetch');

  // ── FHSIS now splits the sub-rows ────────────────────────────────────────
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2500);
  const fhsisTab = page.locator('button', { hasText: /FHSIS/i }).first();
  if (await fhsisTab.count() > 0) {
    await fhsisTab.click();
    await page.waitForTimeout(3000);
    const fh = await page.innerText('body');
    check('FHSIS report renders', /facility-based/i.test(fh));
    // The month picker defaults to a month with data; our visit is today's.
    check('the footnote explains the sub-rows rather than claiming no field exists',
      fh.includes('not classified') || fh.includes('may add up to less than the total') || fh.includes('was classified'),
      'footnote still reads as if the field is missing');
  } else {
    check('FHSIS tab found on Reports', false, 'tab not present');
  }

  // ── A BHO viewer must not see the control ────────────────────────────────
  await page.goto(`${BASE}/logout`).catch(() => {});
  await page.context().clearCookies();
  await page.goto(BASE);
  await page.fill('input[type="email"]', 'bho@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_BHO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/rpc`);
  await page.waitForTimeout(3000);
  const bhoBody = await page.innerText('body');
  const bhoBtns = await page.locator('table tbody button', { hasText: /^Visit [12]$/ }).count();
  check('a BHO viewer sees NO Record button', bhoBtns === 0 || !bhoBody.includes('RPC Records'), `${bhoBtns} buttons`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
};

run()
  .then(cleanup)
  .then(() => process.exit(fail ? 1 : 0))
  .catch(async (e) => { console.error('\nFATAL:', e.message); await cleanup(); process.exit(1); });

