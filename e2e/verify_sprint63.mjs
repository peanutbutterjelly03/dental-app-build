// Sprint 63 — System Admin reaches the operational screens.
//
// The server already allowed it: CLINICAL_WRITE_ROLES includes system_admin and
// reads default to every role. Only the sidebar was hiding Appointments,
// Students, Dental Charts, Treatment, RPC Tracking and Reports.
//
// Risk Classification is deliberately NOT granted — validating a recommendation
// there is clinical sign-off, and the dentist-validates premise is what
// Chapter 3 rests on. This asserts that exclusion rather than leaving it to
// drift.
//
// The part worth testing is not the nav array (that is obvious from the diff)
// but whether the screens actually RENDER for an account whose school_id may be
// null — admins are not attached to a school the way clinical staff are.
//
// Usage: node verify_sprint63.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const SCREENS = [
  ['Appointments', '/appointments', 'Appointments'],
  ['Students', '/patients', 'Student Records'],
  ['Dental Charts', '/dental-charts', 'Dental'],
  ['Treatment', '/treatment-records', 'Treatment'],
  ['RPC Tracking', '/rpc', 'RPC'],
  ['Reports', '/reports', 'Reports'],
];

const run = async () => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set in .env');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  await page.goto(BASE);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  // An account with no school_id resolves to ALL schools (AuthContext
  // resolveUser), so admin hits the same "pick a school" gate any multi-school
  // user gets — BHO staff included. Not a bug; complete the flow, then the
  // sidebar's Switch changes it later.
  if (page.url().includes('/select-school')) {
    console.log('  (school gate shown — selecting the first school)');
    await page.locator('button, [role="button"]').filter({ hasText: 'Bagong Tanyag' }).first().click();
    await page.waitForTimeout(5000);
  }
  console.log(`\nSprint 63 verification against ${BASE}\n`);
  console.log(`  signed in as ${email} → ${new URL(page.url()).pathname}`);

  // Nav contents
  const navLinks = await page.locator('nav a, aside a').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href')).filter(Boolean));
  console.log(`  nav: ${JSON.stringify([...new Set(navLinks)])}`);

  for (const [label, path] of SCREENS) {
    check(`nav offers ${label}`, navLinks.includes(path), JSON.stringify(navLinks));
  }
  check('Risk Classification stays dentist-only (clinical sign-off)',
    !navLinks.includes('/ai-analytics'), 'admin can reach /ai-analytics');
  check('admin keeps its own screens', ['/schools', '/accounts', '/audit'].every((p) => navLinks.includes(p)));

  // The screens must actually render for an account with no school of its own.
  for (const [label, path, marker] of SCREENS) {
    const before = pageErrors.length;
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(3500);
    const text = await page.locator('body').innerText();
    const rendered = text.includes(marker);
    const crashed = pageErrors.length > before;
    check(`${label} renders for System Admin`, rendered && !crashed,
      crashed ? pageErrors[pageErrors.length - 1] : `marker "${marker}" not found`);
  }

  check('no uncaught page errors across all six screens', pageErrors.length === 0,
    JSON.stringify(pageErrors.slice(0, 3)));

  await page.screenshot({ path: 'sprint63_admin.png' });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
