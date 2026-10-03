// Sprint 59 — the DOH report's School filter actually filters.
//
// It did not. `useDohReportData` took no school argument at all, so selecting a
// school changed the printed header, the export filename and the export
// metadata while the FIGURES stayed all-schools. A report titled for one school
// carried all three schools' numbers — on a document submitted to the City
// Health Office.
//
// The test that matters is arithmetic, not appearance: each school's total must
// be its own, and the three must sum to the all-schools total.
//
// Usage: node verify_sprint59.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Sum of every numeric cell on the "No. Orally Examined" row. */
async function examinedTotal(page) {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')]
      .find((tr) => tr.textContent.trim().startsWith('No. Orally Examined'));
    if (!row) return null;
    return [...row.querySelectorAll('td')]
      .map((td) => Number(td.textContent.trim()))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0);
  });
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for something that only exists AFTER sign-in. 'nav, aside' used to
  // work, but the split login (Sprint 61) put an <aside> on the login page
  // itself, so that selector matched instantly and the script carried on
  // unauthenticated.
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(4000);
  await page.click('button:has-text("DOH Consolidated")');
  await page.waitForTimeout(2000);

  const sel = page.locator('#doh-school');
  const options = await sel.locator('option').allTextContents();
  const values = await sel.locator('option').evaluateAll((els) => els.map((e) => e.value));
  console.log(`\nSprint 59 verification against ${BASE}\n`);
  console.log(`  school options: ${JSON.stringify(options)}`);

  const totals = {};
  for (let i = 0; i < values.length; i++) {
    await sel.selectOption(values[i]);
    // The hook refetches seven collections on a school change; wait on the
    // value settling rather than a fixed delay.
    await page.waitForTimeout(3500);
    totals[options[i]] = await examinedTotal(page);
    console.log(`        ${options[i].padEnd(16)} examined = ${totals[options[i]]}`);
  }

  const all = totals['All Schools'];
  const perSchool = Object.entries(totals).filter(([k]) => k !== 'All Schools').map(([, v]) => v);

  check('every school returns a number', Object.values(totals).every((v) => v !== null && Number.isFinite(v)));
  check('per-school totals sum to the all-schools total',
    perSchool.reduce((a, b) => a + b, 0) === all,
    `${perSchool.join(' + ')} = ${perSchool.reduce((a, b) => a + b, 0)}, all = ${all}`);
  // The original bug: every school returned the SAME number as all-schools.
  check('at least one school differs from the all-schools total (the filter is not cosmetic)',
    perSchool.some((v) => v !== all),
    `per-school: ${JSON.stringify(perSchool)}, all: ${all}`);
  check('not every school shows the same figure',
    new Set(perSchool).size > 1 || perSchool.length === 1,
    JSON.stringify(perSchool));

  // The Program Report shares the picker and must agree. Select explicitly
  // rather than assuming what the loop above left behind.
  await sel.selectOption(values[1]); // first real school
  await page.waitForTimeout(3500);
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3000);
  const header = await page.locator('text=/Barangay Tanyag, Taguig City/').first().innerText();
  check('Program Report names the scope its figures actually cover',
    header.includes(values[1]) || header.includes(options[1]),
    `expected ${values[1]}, got: ${header}`);

  // And "All Schools" must say so rather than borrowing the sidebar's school.
  await page.click('button:has-text("DOH Consolidated")');
  await page.waitForTimeout(1500);
  await sel.selectOption('');
  await page.waitForTimeout(3500);
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3000);
  const allHeader = await page.locator('text=/Barangay Tanyag, Taguig City/').first().innerText();
  check('Program Report says "All schools" when unscoped', allHeader.includes('All schools'), allHeader);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
