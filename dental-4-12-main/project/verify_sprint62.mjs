// Sprint 62 — required fields on Add Student.
//
// Two inverted defects were found: Address was required by the model AND
// enforced but carried no asterisk, and Guardian Name carried an asterisk but
// was never enforced. So the form asked for something it did not need and
// silently needed something it did not ask for, behind a blanket "fill in all
// required fields" message that named nothing.
//
// Enforced at ENTRY only, never in the schema: all 26 existing students predate
// these fields, CRUD updates run mongoose validation through save(), so a
// schema requirement would make every existing record unsaveable.
//
// Usage: node verify_sprint62.mjs [baseUrl]   (default http://localhost:5173)
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for something that only exists AFTER sign-in. 'nav, aside' used to
  // work, but the split login (Sprint 61) put an <aside> on the login page
  // itself, so that selector matched instantly and the script carried on
  // unauthenticated.
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);
  await page.click('button:has-text("Add Student")');
  await page.waitForTimeout(1500);
  console.log(`\nSprint 62 verification against ${BASE}\n`);

  const modal = page.locator('dialog, [role="dialog"]').first();
  const labels = await modal.locator('label').allTextContents();
  const starred = labels.filter((l) => l.includes('*')).map((l) => l.replace(/\s*\*\s*/, '').trim());
  console.log(`  starred: ${JSON.stringify(starred)}`);

  // The two that were wrong, specifically.
  check('Address is now marked required', starred.some((l) => l.startsWith('Address')));
  check('Guardian Contact is now marked required', starred.some((l) => l.startsWith('Guardian Contact')));
  check('Contact Number is now marked required', starred.some((l) => l.startsWith('Contact Number')));
  check('Guardian Name keeps its asterisk', starred.some((l) => l.startsWith('Guardian Name')));

  // The deliberate exceptions.
  check('Middle Name is NOT required', !starred.some((l) => l.startsWith('Middle Name')),
    JSON.stringify(starred.filter((l) => l.startsWith('Middle'))));
  check('PhilHealth Number is NOT required (the stated exception)',
    !starred.some((l) => l.startsWith('PhilHealth Number')));

  // Submitting empty must NAME the missing fields, not say "all required".
  await modal.locator('button:has-text("Add Student")').last().click();
  await page.waitForTimeout(900);
  const err = await modal.locator('[role="alert"], [role="status"]').first().innerText().catch(() => '');
  console.log(`  error text: ${err.replace(/\s+/g, ' ').slice(0, 180)}`);
  check('the error names the missing fields', err.includes('Please fill in:') && err.includes('Address'), err.slice(0, 120));
  check('the error is not the old blanket message', !err.includes('all required fields'), err.slice(0, 120));

  // 4Ps ID must be required ONLY when the household is 4Ps — 0 of 26 students
  // are, so requiring it always would block every ordinary student.
  check('4Ps ID is hidden while the toggle is off', await modal.locator('text=4Ps ID').count() === 0);
  await modal.locator('#is4ps').check();
  await page.waitForTimeout(500);
  const afterToggle = await modal.locator('label').allTextContents();
  check('4Ps ID appears and is required once the toggle is on',
    afterToggle.some((l) => l.includes('4Ps ID') && l.includes('*')),
    JSON.stringify(afterToggle.filter((l) => l.includes('4Ps'))));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
