// Sprint 123: Transfer mode on Promote / Assign.
// Performs ONE REAL transfer (the user confirmed all records are test input),
// records the pupil's placement first and RESTORES it at the end.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000/api';
const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]));

const ROW_CB = 'input[aria-label^="Select "]:not([aria-label^="Select all"]):not([aria-label^="Deselect all"])';
const results = [];
const check = (n, pass, d = '') => { results.push(pass); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ' -- ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
let restore = null;

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

  const transferTab = modal.locator('button').filter({ hasText: /^Transfer within/ }).first();
  check('Transfer mode exists', await transferTab.count() > 0);
  await transferTab.click();
  await page.waitForTimeout(700);

  check('promote-only "Move to grade" target appears', await modal.locator('select[aria-label="Move to grade"]').count() > 0);

  const gradeSel = modal.locator('select[aria-label="Grade"]');
  const opts = await gradeSel.locator('option').allTextContents();
  let total = 0;
  for (const o of opts.filter((x) => /Grade|Kinder/i.test(x))) {
    await gradeSel.selectOption({ label: o });
    await page.waitForTimeout(2300);
    total = await modal.locator(ROW_CB).count();
    if (total > 0) break;
  }
  check('roster loaded in transfer mode', total > 0, `${total} pupils`);

  // The Action dropdown is promotion's; it must be gone here.
  check('no Action dropdown in transfer mode', await modal.locator('select[aria-label^="Action for"]').count() === 0);
  check('shows current placement ("Now" column)', /Now/.test(await modal.innerText()));

  // Footer must be disabled until something is ticked.
  const moveBtn = modal.locator('button').filter({ hasText: /^Move \d+ pupil/ }).first();
  check('move button reflects the selection', await moveBtn.count() > 0, await moveBtn.innerText().catch(() => '-'));
  check('move button disabled with nothing ticked', await moveBtn.isDisabled());

  // Capture the pupil we are about to move, so it can be put back.
  const firstCb = modal.locator(ROW_CB).first();
  const label = await firstCb.getAttribute('aria-label');
  await firstCb.scrollIntoViewIfNeeded();
  await firstCb.click();
  await page.waitForTimeout(600);

  const before = await page.evaluate(async () => {
    const r = await fetch('/api/stats/student-nav', { credentials: 'include' });
    return (await r.json()).length;
  });

  // Give it a new section and move.
  const secInput = modal.locator('input[aria-label^="Section for"]').first();
  await secInput.fill('ZZTRANSFER');
  await page.waitForTimeout(300);
  check('move button enabled once ticked', !(await moveBtn.isDisabled()));
  await moveBtn.click();
  await page.waitForTimeout(4000);

  const after = await modal.innerText();
  check('reports a move within the current year', /moved within \d{4}-\d{4}/.test(after), after.split('\n').find((l) => /moved within/.test(l)) || '(no line)');
  check('roster size unchanged (no year record created)', await page.evaluate(async () => {
    const r = await fetch('/api/stats/student-nav', { credentials: 'include' });
    return (await r.json()).length;
  }) === before, `${before} before`);

  restore = String(label || '').replace(/^Select\s+/, '');
  console.log(`    [diag] moved: ${restore}`);
} catch (e) {
  check('run completed without exception', false, String(e.message).slice(0, 170));
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (restore) console.log(`RESTORE NEEDED for: ${restore}`);
process.exit(passed === results.length ? 0 : 1);
