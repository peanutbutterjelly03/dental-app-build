// Sprint 120 verification: value validation on the Add Student form.
// Reads SEED_* from .env itself. Never saves -- every case asserts a REJECTION,
// so nothing reaches the database.
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

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Dentist: PatientList.tsx:177 gates Add Student on dentist || dental_aide.
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
  if (!page.url().includes('/patients')) {
    await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  }
  if (!page.url().includes('/patients')) throw new Error('never reached /patients: ' + page.url());
  check('on the patient list (precondition)', true, page.url().replace(BASE, ''));

  await page.locator('button').filter({ hasText: 'Add Student' }).first().click();
  await page.waitForTimeout(1200);
  const modal = page.locator('div').filter({ has: page.locator('input[type="date"]') }).last();
  check('Add Student form opened', await page.locator('input[type="date"]').count() > 0);

  // The native date input must refuse a future date outright.
  const dateInput = page.locator('input[type="date"]').first();
  const maxAttr = await dateInput.getAttribute('max');
  const minAttr = await dateInput.getAttribute('min');
  check('birthdate picker is bounded', !!maxAttr && !!minAttr, `min=${minAttr} max=${maxAttr}`);
  const maxYear = maxAttr ? Number(maxAttr.slice(0, 4)) : 0;
  check('picker max is in the past', maxYear > 1900 && maxYear < new Date().getFullYear(), `max year ${maxYear}`);

  // Name inputs carry the documented 60-char cap.
  const nameCap = await page.locator('input[maxlength]').first().getAttribute('maxlength');
  check('name inputs capped at 60', nameCap === '60', `maxlength=${nameCap}`);

  // ALL CAPS must be accepted -- the DOH form is filled in caps.
  const textInputs = page.locator('input[maxlength="60"]');
  await textInputs.nth(0).fill('MORALES');
  const caps = await textInputs.nth(0).inputValue();
  check('ALL CAPS accepted, not rewritten', caps === 'MORALES', caps);

  // A bad phone must block the save and say which field.
  await textInputs.nth(1).fill('JUAN');
  const phone = page.locator('input[placeholder="09XX-XXX-XXXX"]').first();
  await phone.fill('12345');
  await page.locator('button').filter({ hasText: /^Add Student$|^Save$|^Add$/ }).last().click();
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText();
  const named = /Contact Number|Please fill in/i.test(body);
  check('bad input blocks the save with a named field', named);
  check('nothing was saved (still on the form)', await page.locator('input[type="date"]').count() > 0);
} catch (e) {
  check('run completed without exception', false, String(e.message).slice(0, 160));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
