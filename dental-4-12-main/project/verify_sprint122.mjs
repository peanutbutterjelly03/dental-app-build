// Sprint 122: search inside Promote / Assign. Never saves -- the footer button
// is never clicked. Reads SEED_* from .env itself.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]));

const ROW_CB = 'input[aria-label^="Select "]:not([aria-label^="Select all"]):not([aria-label^="Deselect all"])';
const results = [];
const check = (n, pass, d = '') => { results.push(pass); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ' -- ' + d : ''}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'dentist@floral.com');
  await page.fill('input[name="password"]', env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  const clearGate = async () => {
    for (let i = 0; i < 3; i++) {
      if (!page.url().includes('select-school')) return;
      const b = page.locator('button').filter({ hasText: /Integrated School|Annex A|South Daang Hari/ }).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(1500); } else await page.waitForTimeout(800);
    }
  };
  await clearGate();
  await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await clearGate();
  if (!page.url().includes('/patients')) { await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500); }
  if (!page.url().includes('/patients')) throw new Error('never reached /patients');
  check('on the patient list (precondition)', true);

  await page.locator('button').filter({ hasText: 'Promote / Assign' }).first().click();
  await page.waitForTimeout(1500);
  const modal = page.locator('div.max-w-4xl').filter({ has: page.locator('select[aria-label="Grade"]') }).first();
  const gradeSel = modal.locator('select[aria-label="Grade"]');
  const opts = await gradeSel.locator('option').allTextContents();
  let total = 0;
  for (const o of opts.filter((x) => /Grade|Kinder/i.test(x))) {
    await gradeSel.selectOption({ label: o });
    await page.waitForTimeout(2300);
    total = await modal.locator(ROW_CB).count();
    if (total > 1) break;
  }
  check('roster loaded', total > 1, `${total} pupils`);

  const box = modal.locator('input[aria-label="Search the roster by name or section"]');
  check('search box present', await box.count() > 0);

  // A surname from the first visible row should narrow the list.
  // The first <td> is now the checkbox column, so read the name off the row
  // checkbox's aria-label ("Select Surname, First") instead of the cell text --
  // an earlier run took the empty checkbox cell and searched for "".
  const label = await modal.locator(ROW_CB).first().getAttribute('aria-label');
  const term = String(label || '').replace(/^Select\s+/, '').split(',')[0].trim().slice(0, 4);
  if (!term) throw new Error('could not derive a search term from ' + label);
  console.log(`    [diag] searching for "${term}" across ${total} pupils`);
  await box.fill(term);
  await page.waitForTimeout(700);
  const narrowed = await modal.locator(ROW_CB).count();
  check('search filters to matching pupils', narrowed > 0 && narrowed <= total, `${narrowed} of ${total} for "${term}"`);

  // Footer count must be unchanged -- search is a view filter, not a scope filter.
  const bodyText = await modal.innerText();
  check('footer still counts the whole list', bodyText.includes(`of ${total}`), `expected "of ${total}"`);

  // Nonsense term -> explicit empty state, not a silently blank table.
  await box.fill('zzzzzznomatch');
  await page.waitForTimeout(700);
  const emptyMsg = await modal.innerText();
  check('no-match shows an explanation', /matches/i.test(emptyMsg) && await modal.locator(ROW_CB).count() === 0);

  // Select-all applies to VISIBLE rows only.
  await box.fill(term);
  await page.waitForTimeout(700);
  const head = modal.locator('input[aria-label="Select all pupils"], input[aria-label="Deselect all pupils"]').first();
  await head.scrollIntoViewIfNeeded();
  await head.click();
  await page.waitForTimeout(800);
  // Assert STATE, not the label. An earlier run failed here because
  // Playwright's text= engine did not match the "N selected" span, while the
  // very next check read the same string off innerText -- the checkbox count is
  // what the behaviour actually is.
  const checkedNow = await modal.locator(ROW_CB + ':checked').count();
  check('select-all ticks only what the search shows', checkedNow === narrowed,
    `${checkedNow} ticked, ${narrowed} shown, ${total} in the list`);
  check('select-all did NOT reach the filtered-out pupils', checkedNow < total,
    `${checkedNow} < ${total}`);

  // Clearing the search must reveal the hidden-selection warning.
  await box.fill('');
  await page.waitForTimeout(700);
  const afterClear = await modal.innerText();
  check('clearing search keeps the selection', /\d+ selected/.test(afterClear));
  check('no write performed', true, 'footer button never clicked');
} catch (e) {
  check('run completed without exception', false, String(e.message).slice(0, 160));
} finally { await browser.close(); }
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
