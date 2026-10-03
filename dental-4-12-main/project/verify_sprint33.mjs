// Sprint 33 verification — mobile navigation drawer.
// Runs against the LOCAL dev stack (vite :5173 + server :4000).
// Checks the drawer at 375px and confirms desktop is untouched at 1440px.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
// Defaults to the local dev stack; set BASE_URL to check the deployed site:
//   BASE_URL=https://dental-app-build.vercel.app node verify_sprint33.mjs
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = join(REPO, 'docs', 'figures', 'sprint33');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const env = {};
// ⚠ Split on /\r?\n/, not '\n'. The repo checks out with CRLF endings, so every
// line kept a trailing \r — and \r is a LINE TERMINATOR in a JS regex, so the
// `(.*)$` below never matched and this parser silently produced an EMPTY env.
// It surfaced as `page.fill: expected string, got undefined`, which reads like
// a selector problem rather than a parsing one.
for (const line of readFileSync(join(HERE, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const checks = [];
const check = (name, pass, detail = '') =>
  checks.push({ name, pass, detail });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  for (let i = 0; i < 40 && page.url().includes('login'); i++) await page.waitForTimeout(500);
  if (page.url().includes('select-school')) {
    const cards = page.locator('.grid button');
    if (await cards.count()) { await cards.first().click(); await page.waitForTimeout(2000); }
  }
  await page.waitForTimeout(2000);
  return !page.url().includes('login');
}

const browser = await chromium.launch();

// ============ MOBILE 375px ============
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  check('login (mobile)', await login(page));

  const drawer = page.locator('#main-nav');
  const hamburger = page.getByRole('button', { name: /open navigation menu/i });

  // 1. closed by default; top bar present
  check('top bar visible', await hamburger.isVisible());
  check('drawer hidden by default', !(await drawer.isVisible()));
  await page.screenshot({ path: join(OUT, 'm1-closed.png'), fullPage: false });

  // 2. content is full width (no 60px rail eating the screen)
  const mainBox = await page.locator('main').boundingBox();
  check('main starts at x=0 (rail gone)', mainBox && mainBox.x === 0, `x=${mainBox?.x}`);

  // 3. open it
  await hamburger.click();
  await page.waitForTimeout(600);
  check('drawer opens', await drawer.isVisible());

  // 4. every destination is NAMED (the actual bug)
  const expected = ['Dashboard', 'Appointments', 'Students', 'Dental Charts',
                    'Risk Classification', 'Treatment', 'RPC Tracking', 'Reports'];
  const missing = [];
  for (const label of expected) {
    const link = drawer.getByRole('link', { name: new RegExp(label, 'i') }).first();
    const visible = (await link.count()) && (await link.isVisible());
    if (!visible) missing.push(label);
  }
  check('all nav labels visible', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${expected.length}/${expected.length}`);

  // 5. The school in view is reachable on mobile (was impossible before).
  //
  // ⚠ REWRITTEN 2026-09-03. This asserted a "Switch School" BUTTON, which
  // Sprint 67 deliberately replaced with a <select id="school-switcher"> that is
  // HIDDEN for single-school accounts ("a one-option picker is noise"). The
  // check had been failing against correct code ever since — it was testing a
  // control the design had removed, not a regression.
  //
  // What must hold now is the durable requirement, which survives that change:
  // a mobile user can always SEE which school they are in, and can CHANGE it
  // whenever the account actually has more than one.
  const switcher = drawer.locator('#school-switcher');
  const schoolCount = await switcher.locator('option').count(); // 0 when absent
  if (schoolCount > 0) {
    check('school switcher reachable in the drawer (multi-school account)', await switcher.isVisible());
  } else {
    // Single-school account: the dropdown is correctly absent, so the top bar
    // must still name the school.
    const chip = page.locator('header span').last();
    check('single-school account: the school is still named on screen',
      (await chip.count()) > 0 && (await chip.innerText()).trim().length > 0,
      'no school name visible in the mobile header');
  }

  // 6. identity visible
  check('user name visible', await drawer.getByText(/Dr\. Maria Santos/i).first().isVisible().catch(() => false));
  check('role badge visible', await drawer.getByText(/^dentist$/i).first().isVisible().catch(() => false));

  // 7. logout + change password reachable
  check('logout reachable', await drawer.getByRole('button', { name: /logout/i }).first().isVisible());
  check('change password reachable', await drawer.getByRole('button', { name: /change password/i }).first().isVisible());

  await page.screenshot({ path: join(OUT, 'm2-open.png'), fullPage: false });

  // 8. background scroll locked while open
  const locked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  check('body scroll locked', locked === 'hidden', `overflow=${locked}`);

  // 9. Escape closes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check('Escape closes drawer', !(await drawer.isVisible()));
  const unlocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  check('scroll lock released', unlocked !== 'hidden', `overflow=${unlocked}`);

  // 10. backdrop closes
  await hamburger.click(); await page.waitForTimeout(500);
  await page.mouse.click(350, 400); // right of the 280px drawer
  await page.waitForTimeout(600);
  check('backdrop closes drawer', !(await drawer.isVisible()));

  // 11. navigating closes it and actually goes there
  await hamburger.click(); await page.waitForTimeout(500);
  await drawer.getByRole('link', { name: /RPC Tracking/i }).first().click();
  await page.waitForTimeout(2000);
  check('nav click closes drawer', !(await drawer.isVisible()));
  check('nav click navigates', page.url().includes('/rpc'), page.url());
  await page.screenshot({ path: join(OUT, 'm3-after-nav.png'), fullPage: false });

  // 12. offline banner must not be covered — the reason the bar is sticky
  const barPos = await page.locator('header').first().evaluate((el) => getComputedStyle(el).position);
  check('top bar is sticky not fixed', barPos === 'sticky', `position=${barPos}`);

  await ctx.close();
}

// ============ DESKTOP 1440px — must be unchanged ============
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  check('login (desktop)', await login(page));

  const aside = page.locator('#main-nav');
  const box = await aside.boundingBox();
  check('desktop sidebar visible', await aside.isVisible());
  check('desktop sidebar width 220px', box && Math.round(box.width) === 220, `width=${box?.width}`);

  const hamburger = page.getByRole('button', { name: /open navigation menu/i });
  check('no hamburger on desktop', !(await hamburger.isVisible().catch(() => false)));

  const mainBox = await page.locator('main').boundingBox();
  check('desktop main offset by 220px', mainBox && Math.round(mainBox.x) === 220, `x=${mainBox?.x}`);

  check('desktop labels visible', await aside.getByRole('link', { name: /Dental Charts/i }).first().isVisible());
  await page.screenshot({ path: join(OUT, 'd1-desktop.png'), fullPage: false });

  // collapse toggle still works
  const toggle = page.getByRole('button', { name: /collapse sidebar/i }).first();
  if (await toggle.count()) {
    await toggle.click(); await page.waitForTimeout(700);
    const cbox = await aside.boundingBox();
    check('desktop collapse -> 60px', cbox && Math.round(cbox.width) === 60, `width=${cbox?.width}`);
    await page.screenshot({ path: join(OUT, 'd2-desktop-collapsed.png'), fullPage: false });
  } else check('desktop collapse toggle present', false, 'toggle not found');

  await ctx.close();
}

await browser.close();

const pass = checks.filter((c) => c.pass).length;
console.log(`\n===== ${pass}/${checks.length} checks passed =====`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
process.exit(pass === checks.length ? 0 : 1);
