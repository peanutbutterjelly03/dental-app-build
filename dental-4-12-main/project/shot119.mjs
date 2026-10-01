// Sprint 119 responsive check: the bulk bar at all three device widths
// (CLAUDE.md APP CONTEXT — phone ~390, tablet ~768, laptop ~1280+).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = 'http://localhost:5173';
const OUT = process.env.SHOTS;

const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);

const ROW_CB = 'input[aria-label^="Select "]:not([aria-label^="Select all"]):not([aria-label^="Deselect all"])';

for (const [name, width, height] of [['phone', 390, 844], ['tablet', 768, 1024], ['laptop', 1280, 800]]) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', 'dentist@floral.com');
    await page.fill('input[name="password"]', env.SEED_DENTIST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
    // Clearing the gate NAVIGATES to the dashboard, so /patients must be asked
    // for AFTER the gate is gone -- and re-checked, because the first /patients
    // request can itself bounce back to the gate. This script had the weak
    // version and failed at ALL THREE widths, which looked like a responsive
    // bug and was not.
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
    if (!page.url().includes('/patients')) {
      await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
    }
    if (!page.url().includes('/patients')) throw new Error('never reached /patients: ' + page.url());
    await page.waitForTimeout(1500);
    await page.locator('button').filter({ hasText: 'Promote / Assign' }).first().click();
    await page.waitForTimeout(1500);
    const modal = page.locator('div.max-w-4xl').filter({ has: page.locator('select[aria-label="Grade"]') }).first();
    const gradeSel = modal.locator('select[aria-label="Grade"]');
    const opts = await gradeSel.locator('option').allTextContents();
    for (const o of opts.filter((x) => /Grade|Kinder/i.test(x))) {
      await gradeSel.selectOption({ label: o });
      await page.waitForTimeout(2200);
      if (await modal.locator(ROW_CB).count() > 0) break;
    }
    const head = modal.locator('input[aria-label="Select all pupils"]').first();
    if (await head.count()) { await head.click(); await page.waitForTimeout(700); }
    const bar = await modal.locator('text=/\\d+ selected/').count();
    // Does the page scroll sideways? CLAUDE.md: the body must never.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name.padEnd(7)} ${width}px  bulkBarVisible=${bar > 0}  horizontalOverflow=${overflow}px`);
    await page.screenshot({ path: `${OUT}/s119-${name}.png`, fullPage: false });
  } catch (e) {
    console.log(`${name.padEnd(7)} ${width}px  ERROR ${String(e.message).slice(0, 100)}`);
  } finally {
    await browser.close();
  }
}
