// Sprint 106 — Risk Classification now has the same five filters every other
// student list has, and the age brackets are shared rather than duplicated.
import fs from 'node:fs';
import { chromium } from 'playwright';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const results = [];
const check = (n, pass, detail) => results.push({ check: n, result: pass ? 'PASS' : 'FAIL', detail });

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

// Since Sprint 100 the dentist holds three schools, so the gate fires on a
// fresh profile. Clear it or every assertion below lands on the picker.
await page.goto(`${BASE}/ai-analytics`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
if (page.url().includes('/select-school')) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /School/i.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/ai-analytics`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
}
check('Risk Classification screen loaded (not the school gate)',
  !page.url().includes('/select-school'), page.url().replace(BASE, ''));

const labels = await page.evaluate(() =>
  [...document.querySelectorAll('select')].map((s) => s.getAttribute('aria-label')).filter(Boolean));
check('gender filter present', labels.includes('Filter by gender'), labels.join(' | '));
check('age group filter present', labels.includes('Filter by age group'), labels.join(' | '));

// The brackets must be the SAME list the student list offers.
const ageOpts = await page.evaluate(() => {
  const el = [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Filter by age group');
  return el ? [...el.options].map((o) => o.textContent.trim()) : [];
});
const expected = ['All Age Groups', '4 & below', '5-9', '10-14', '15-19', '20 & above'];
check('age brackets match the shared list', JSON.stringify(ageOpts) === JSON.stringify(expected), ageOpts.join(', '));

// Selecting a gender must actually narrow the rows, not just change a label.
// ⚠ The candidate list is a DIV list, not a table — `table tbody tr` counts
// zero and reads exactly like "the filter broke". Count the rows in the
// divide-y scroll container instead, and treat the empty-state card as zero.
const countRows = () => page.evaluate(() => {
  const el = document.querySelector('div.overflow-y-auto.divide-y');
  if (!el) return -1;
  if (el.textContent.includes('No students found')) return 0;
  return el.children.length;
});
const before = await countRows();
await page.selectOption('select[aria-label="Filter by gender"]', 'Female');
await page.waitForTimeout(1200);
const after = await countRows();
check('gender filter actually filters the rows', before > 0 && after <= before && after !== before,
  `${before} rows -> ${after} with Female`);

console.table(results);
await browser.close();
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
