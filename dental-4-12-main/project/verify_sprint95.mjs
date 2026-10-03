// Sprint 95 — the school switcher survives a collapsed sidebar.
//
// Reported by the user as "switching schools now missing". Reproduced: the
// dropdown is `hidden md:hidden` when the sidebar is collapsed, and
// `sidebarCollapsed` PERSISTS in localStorage — so one collapse hid it for
// good. These checks cover all three states, because a fix that only works
// expanded fixes nothing.
//
// Read-only: creates nothing. It toggles the sidebar, which is local UI state.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  if (await page.locator('text=Select a school to continue').count()) {
    await page.getByText('BT Integrated School').first().click();
  }
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log(`\nSprint 95 verification against ${BASE}\n`);

  const select = page.locator('#school-switcher');
  const iconBtn = page.locator('button[aria-label^="Change school"]');

  check('expanded: the dropdown is visible', await select.isVisible());
  check('expanded: no duplicate icon button competing with it', !(await iconBtn.isVisible()));

  await page.click('[aria-label="Collapse sidebar"]');
  await page.waitForTimeout(900);
  check('COLLAPSED: some way to change school is still offered', await iconBtn.isVisible());
  check('COLLAPSED: it names the school it is showing', /Currently viewing/i.test(await iconBtn.getAttribute('aria-label') ?? ''),
    await iconBtn.getAttribute('aria-label'));

  // The affordance has to WORK, not just appear (CLAUDE.md: a control that
  // appears to work must work).
  await iconBtn.click();
  await page.waitForTimeout(900);
  check('COLLAPSED: clicking it reveals the real dropdown', await select.isVisible());

  // And the dropdown still actually switches school.
  const before = await select.inputValue();
  const options = await select.locator('option').all();
  const other = await Promise.all(options.map((o) => o.getAttribute('value')));
  const target = other.find((v) => v && v !== before);
  if (target) {
    await select.selectOption(target);
    await page.waitForTimeout(1200);
    check('the dropdown still changes the selected school', (await select.inputValue()) === target,
      `${before} -> ${await select.inputValue()}`);
  }

  // The collapse state persists, which is why the bug was sticky — so prove
  // the fix survives a reload in the collapsed state.
  await page.click('[aria-label="Collapse sidebar"]');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(2500);
  check('after a reload still collapsed, the affordance is there', await iconBtn.isVisible());

  // Mobile: the drawer holds the full dropdown, so no icon fallback is wanted.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(900);
  check('mobile: the collapsed-rail icon is not shown (the drawer carries the real one)',
    !(await iconBtn.isVisible()));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
