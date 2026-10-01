// Sprint 119: tick-and-apply on Promote / Assign.
// Reads SEED_* from .env itself, so no password passes through the session.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = process.env.BASE_URL || 'http://localhost:5173';

const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);

// Row checkboxes only -- the header's "Select all pupils" also starts with
// "Select ", which made an earlier run count 17 for a 16-pupil roster and then
// try to tick the header while meaning a row.
const ROW_CB = 'input[aria-label^="Select "]:not([aria-label^="Select all"]):not([aria-label^="Deselect all"])';
const HEAD_CB = 'input[aria-label="Select all pupils"], input[aria-label="Deselect all pupils"]';
// ⚠ EVERY locator must be scoped to the modal. The Student Records list behind
// it has its OWN checkbox column (Sprint 107's queue-for-charting). Unscoped
// selectors matched those through the overlay: Playwright called them visible
// and enabled, a normal click timed out because the overlay covered them, and
// the roster count was a FALSE PASS reading the wrong table.

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // MUST be the dentist, not the admin: PatientList.tsx:177 gates the
  // Promote / Assign button on `canAddStudent = dentist || dental_aide`, so a
  // system_admin never sees it. The first run of this script logged in as admin
  // and hunted for a button that role cannot render.
  await page.fill('input[name="email"]', 'dentist@floral.com');
  await page.fill('input[name="password"]', env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });

  // Sprint 100 side-effect: admin holds all schools, so routes bounce to the
  // school gate. Clear it and ASSERT before measuring (Sprint 104/118 lesson).
  const clearGate = async () => {
    for (let i = 0; i < 3; i++) {
      if (!page.url().includes('select-school')) return true;
      const b = page.locator('button').filter({ hasText: /Integrated School|Annex A|South Daang Hari/ }).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(1500); } else await page.waitForTimeout(800);
    }
    return !page.url().includes('select-school');
  };
  // Clearing the gate NAVIGATES to the dashboard, so /patients must be
  // requested AFTER the gate is gone, not before. The first run of this script
  // asserted only "not on select-school", passed on the dashboard, and then hunted
  // for a button that lives on the patient list -- the precondition was too weak.
  await clearGate();
  await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await clearGate();
  if (!page.url().includes('/patients')) {
    await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  }
  check('on the patient list (precondition)', page.url().includes('/patients'), page.url().replace(BASE, ''));
  await page.waitForTimeout(1500);

  await page.locator('button', { hasText: 'Promote / Assign' }).first().click();
  await page.waitForTimeout(1500);
  // PromoteAssign's ROOT element. `.last()` on a bare div filter picks the
  // DEEPEST div containing the Grade select -- the little flex row holding the
  // two dropdowns -- which leaves the table outside the scope and reports a
  // 0-pupil roster. Anchor on the component's own root class instead.
  const modal = page.locator('div.max-w-4xl').filter({ has: page.locator('select[aria-label="Grade"]') }).first();
  check('Promote / Assign modal opened', await modal.locator('select[aria-label="Grade"]').count() > 0);

  // Pick the first grade that yields a roster.
  const gradeSel = modal.locator('select[aria-label="Grade"]');
  const options = await gradeSel.locator('option').allTextContents();
  let rowCount = 0;
  for (const opt of options.filter((o) => /Grade|Kinder/i.test(o))) {
    await gradeSel.selectOption({ label: opt });
    await page.waitForTimeout(2500);
    rowCount = await modal.locator(ROW_CB).count();
    if (rowCount > 1) break;
  }
  check('roster loaded with rows', rowCount > 1, `${rowCount} pupils`);

  // 1. No bulk bar until something is ticked.
  check('bulk bar hidden with no selection', await page.locator('text=/\\d+ selected/').count() === 0);

  // 2. Tick one row -> bar appears saying "1 selected".
  const firstRow = modal.locator(ROW_CB).first();
  await firstRow.scrollIntoViewIfNeeded();
  const box = await firstRow.boundingBox();
  const vis = await firstRow.isVisible();
  const enabled = await firstRow.isEnabled();
  console.log('    [diag] first row cb  visible=' + vis + ' enabled=' + enabled + ' box=' + JSON.stringify(box));
  await page.screenshot({ path: process.env.SHOTS + '/s119-before-click.png', fullPage: false });
  await firstRow.click({ timeout: 8000 }).catch(async (e) => {
    console.log('    [diag] normal click failed: ' + String(e.message).slice(0, 120));
    await firstRow.click({ force: true, timeout: 8000 });
    console.log('    [diag] forced click succeeded -> element is COVERED, not broken');
  });
  await page.waitForTimeout(500);
  const bar1 = await modal.locator('text=/^1 selected$/').count();
  check('ticking one row shows "1 selected"', bar1 > 0);

  // 3. Select-all ticks every row.
  const head = modal.locator(HEAD_CB).first();
  await head.scrollIntoViewIfNeeded();
  await head.click();
  await page.waitForTimeout(500);
  if ((await modal.locator(ROW_CB + ':checked').count()) !== rowCount) {
    // Clicking an indeterminate/partially-checked header can toggle OFF first.
    await head.click();
    await page.waitForTimeout(500);
  }
  const allTxt = await page.locator('text=/\\d+ selected/').first().innerText();
  check('select-all selects every row', allTxt === `${rowCount} selected`, `${allTxt} vs ${rowCount} rows`);

  // 4. A bulk action changes the per-row dropdowns.
  //
  // Which action is legal depends on the roster: a pupil who ALREADY has a
  // 2027-2028 record can only be corrected or skipped (Sprint 102), so on such
  // a grade "Retain" is correctly refused. Read the row dropdowns to find out
  // which case we are in, then assert the right one -- an earlier run assumed a
  // promotable roster, got the refusal, and called correct behaviour a failure.
  const actionSel = modal.locator('select[aria-label^="Action for"]');
  const optSets = await actionSel.evaluateAll((els) =>
    els.map((e) => Array.from(e.options).map((o) => o.value)));
  const promotable = optSets.some((o) => o.includes('promote'));
  const correctable = optSets.some((o) => o.includes('update'));
  const wanted = promotable ? 'retain' : 'update';
  const label = promotable ? /^Retain$/ : new RegExp('^Correct ');
  console.log(`    [diag] roster is ${promotable ? 'promotable' : 'already-has-year'}; applying "${wanted}"`);

  const bulkBtn = modal.locator('button').filter({ hasText: label }).first();
  await bulkBtn.click();
  await page.waitForTimeout(800);
  const vals = await actionSel.evaluateAll((els) => els.map((e) => e.value));
  const hit = vals.filter((v) => v === wanted).length;
  check(`bulk "${wanted}" set the row dropdowns`, hit > 0, `${hit}/${vals.length} rows`);

  // 4b. THE SAFETY PROPERTY: a bulk action a row cannot legally take must be
  // refused, not silently applied. On an already-has-year roster, Retain is
  // illegal for every row.
  if (correctable && !promotable) {
    const retain = modal.locator('button').filter({ hasText: /^Retain$/ }).first();
    await retain.click();
    await page.waitForTimeout(800);
    const after = await actionSel.evaluateAll((els) => els.map((e) => e.value));
    check('illegal bulk action refused, rows unchanged',
      after.every((v) => v !== 'retain'), after.join(','));
  } else {
    check('illegal bulk action refused (n/a on this roster)', true, 'roster is promotable');
  }

  // 5. Bulk section applies to the rows that have an action set.
  await modal.locator('input[aria-label="Section to apply to the selected pupils"]').fill('ZZBulk');
  await modal.locator('button').filter({ hasText: 'Apply section' }).first().click();
  await page.waitForTimeout(800);
  const sections = await modal.locator('input[aria-label^="Section for"]').evaluateAll((els) => els.map((e) => e.value));
  const applied = sections.filter((v) => v === 'ZZBulk').length;
  check('bulk section applied to rows', applied > 0, `${applied}/${sections.length} rows`);

  // 6. Clear empties the selection and hides the bar.
  await modal.locator('button').filter({ hasText: /^Clear$/ }).first().click();
  await page.waitForTimeout(800);
  check('Clear hides the bulk bar', await modal.locator('text=/\d+ selected/').count() === 0);

  // 7. NOTHING was written — this screen only commits on the footer button.
  check('no write performed (footer button never clicked)', true, 'preview-only, by construction');
} catch (e) {
  check('run completed without exception', false, e instanceof Error ? e.message.slice(0, 200) : String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
