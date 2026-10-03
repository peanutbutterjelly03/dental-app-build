// Sprint 61 — split login layout.
//
// Layout only: the form, its three steps (credentials / OTP / forgot) and all
// handlers are untouched. What must be proven is therefore (a) the split shows
// on a laptop and collapses on a phone, and (b) the two things a restructure
// could quietly break — Sprint 37's "Remember me" and Sprint 50's browser
// autofill, which depends on the autocomplete attributes surviving the move.
//
// Usage: node verify_sprint61.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const run = async () => {
  const browser = await chromium.launch();
  console.log(`\nSprint 61 verification against ${BASE}\n`);

  // ── Laptop: two panes, divider present ───────────────────────────────────
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}/login`);
  await desktop.waitForSelector('input[type="email"]', { timeout: 20000 });

  const aside = desktop.locator('aside');
  check('brand pane is visible on a laptop', await aside.isVisible());
  const asideBox = await aside.boundingBox();
  const formBox = await desktop.locator('input[type="email"]').boundingBox();
  check('brand pane is on the LEFT of the form', asideBox.x + asideBox.width <= formBox.x + 1,
    `aside ends ${Math.round(asideBox.x + asideBox.width)}, form starts ${Math.round(formBox.x)}`);
  check('each pane takes about half the width', Math.abs(asideBox.width - 720) < 60, `${Math.round(asideBox.width)}px`);
  check('brand pane states the system purpose', (await aside.innerText()).includes('Barangay Tanyag'));

  // The divider is an ::after on the aside — assert it is actually painted.
  const divider = await aside.evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { content: cs.content, width: cs.width, image: cs.backgroundImage };
  });
  check('a divider is painted between the panes',
    divider.image.includes('gradient') && divider.width === '1px', JSON.stringify(divider));

  // The compact header must NOT also show at this width (it would duplicate).
  const dupTitles = await desktop.locator('h1:has-text("FLORAL")').count();
  const visibleTitles = await desktop.locator('h1:has-text("FLORAL")').evaluateAll(
    (els) => els.filter((e) => e.offsetParent !== null).length);
  check('exactly one FLORAL heading is visible on a laptop', visibleTitles === 1, `${visibleTitles} of ${dupTitles}`);

  // ── Phone: single column, brand pane hidden ──────────────────────────────
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE}/login`);
  await phone.waitForSelector('input[type="email"]', { timeout: 20000 });
  check('brand pane is hidden on a phone', !(await phone.locator('aside').isVisible()));
  const phoneVisibleTitles = await phone.locator('h1:has-text("FLORAL")').evaluateAll(
    (els) => els.filter((e) => e.offsetParent !== null).length);
  check('the compact header takes over on a phone', phoneVisibleTitles === 1, `${phoneVisibleTitles}`);
  // The password field must be reachable without scrolling past the fold.
  const pwBox = await phone.locator('input[type="password"]').boundingBox();
  check('password field is above the fold on a phone', pwBox.y + pwBox.height < 844, `y=${Math.round(pwBox.y)}`);
  const bodyScrollW = await phone.evaluate(() => document.documentElement.scrollWidth);
  check('no horizontal scrolling on a phone', bodyScrollW <= 390, `${bodyScrollW}px`);

  // ── The two features a restructure could break ───────────────────────────
  check('"Remember me" checkbox is still present',
    await desktop.locator('input[type="checkbox"]').count() > 0);
  const emailAc = await desktop.locator('input[type="email"]').getAttribute('autocomplete');
  const pwAc = await desktop.locator('input[type="password"]').getAttribute('autocomplete');
  check('email keeps its autocomplete attribute (browser autofill)', emailAc === 'username' || emailAc === 'email', String(emailAc));
  check('password keeps autocomplete="current-password"', pwAc === 'current-password', String(pwAc));
  check('Forgot password link survived', await desktop.locator('text=Forgot password?').count() > 0);

  await desktop.screenshot({ path: 'sprint61_desktop.png' });
  await phone.screenshot({ path: 'sprint61_phone.png' });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
