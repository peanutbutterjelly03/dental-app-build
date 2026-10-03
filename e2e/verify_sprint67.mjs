// Sprint 67 — inline school switcher + local-language treatment terms.
//
// Both borrowed from the Base44 prototype clone (scanned 2026-09-02): it puts
// the school selector in the sidebar rather than behind a separate screen, and
// labels services with the words the clinic actually uses.
//
// The switcher is the risky half. "All schools" leaves `selectedSchool` null,
// and RootLayout redirected to the school gate on exactly that condition — so
// choosing "all" would have bounced the user straight back to the picker. The
// gate now keys on whether a CHOICE was made, not on the value.
//
// Usage: node verify_sprint67.mjs [baseUrl]
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  // Admin has all three schools, so the switcher renders.
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_ADMIN_EMAIL);
  await page.fill('input[type="password"]', process.env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  console.log(`\nSprint 67 verification against ${BASE}\n`);

  if (page.url().includes('/select-school')) {
    await page.locator('button, [role="button"]').filter({ hasText: 'Bagong Tanyag' }).first().click();
    await page.waitForTimeout(4500);
  }

  const sw = page.locator('#school-switcher');
  check('the sidebar has an inline school switcher', await sw.count() > 0);
  const opts = await sw.locator('option').allTextContents();
  check('it offers "All schools" plus every assigned school', opts[0] === 'All schools' && opts.length === 4, JSON.stringify(opts));

  // The critical one: choosing "all" must NOT bounce back to the school gate.
  await sw.selectOption('__ALL__');
  await page.waitForTimeout(3000);
  check('choosing "All schools" stays in the app (no bounce to the gate)',
    !page.url().includes('/select-school'), page.url());
  check('the switcher still shows "All schools" after choosing it',
    await sw.inputValue() === '__ALL__', await sw.inputValue());

  // And it must survive a reload — the choice is persisted, not just in memory.
  await page.reload();
  await page.waitForTimeout(5000);
  check('"All schools" survives a reload', !page.url().includes('/select-school'), page.url());
  check('the switcher restores "All schools" after reload',
    await page.locator('#school-switcher').inputValue() === '__ALL__');

  // Switching to a real school still works, and does not navigate away.
  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);
  const before = page.url();
  await page.locator('#school-switcher').selectOption({ index: 1 });
  await page.waitForTimeout(3000);
  check('switching school keeps you on the same screen', page.url() === before, `${before} → ${page.url()}`);

  // ── Local-language terms ─────────────────────────────────────────────────
  await page.goto(`${BASE}/rpc`);
  await page.waitForTimeout(3000);
  const rpcOpts = (await page.locator('select option').allTextContents()).join(' | ');
  check('RPC treatment filter shows local terms', rpcOpts.includes('Bunot') && rpcOpts.includes('Linis'),
    rpcOpts.slice(0, 200));

  // The DOH report must NOT — it is filed, and the form's wording is official.
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(4000);
  await page.click('button:has-text("Internal Reports")');
  await page.waitForTimeout(2500);
  const reportText = await page.locator('body').innerText();
  check('official report rows keep the clinical wording only',
    !reportText.includes('(Bunot)') && !reportText.includes('(Linis)'),
    'a local term leaked into a filed report');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
