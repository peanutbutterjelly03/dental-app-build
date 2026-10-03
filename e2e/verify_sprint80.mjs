// Sprint 80 — DOH caption reconciliation.
//
// Asserts the corrected captions actually reach the screen and the wrong ones
// are gone. A rename that only lands in source is worth nothing: these strings
// are printed on a form filed with the City Health Office.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2500);
  console.log(`\nSprint 80 verification against ${BASE}\n`);

  // ── Program Report ──────────────────────────────────────────────────────
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3000);
  const ohprf = await page.innerText('body');
  check('Program Report renders', ohprf.includes('Person Attended') || ohprf.length > 500);
  for (const good of ['0-8 mos', 'Total (0-11 mos)', '5 yrs old', 'Total (5 - 9 yrs old)', '60 yrs & Above', 'Total Other Adults', '20-49 yrs old']) {
    check(`corrected caption present: "${good}"`, ohprf.includes(good));
  }
  // The pregnant band was simply wrong; make sure it is really gone.
  check('the wrong pregnant band "20-59 y/o" is gone', !ohprf.includes('20-59 y/o'));
  check('the wrong infant band "0-6 mos" is gone', !ohprf.includes('0-6 mos'));
  check('"Total (Infants)" guess is gone', !ohprf.includes('Total (Infants)'));

  // ── Target Client List ──────────────────────────────────────────────────
  await page.click('button:has-text("Target Client List")');
  await page.waitForTimeout(3000);
  const tcl = await page.innerText('body');
  check('TCL renders', tcl.length > 500);
  check('invented acronym "BPOC" is gone from the TCL', !tcl.includes('BPOC'));
  check('"Complete RPC" caption is present', tcl.includes('Complete RPC'));
  check('"Referred Out" replaces "Referral"', tcl.includes('Referred Out'));
  check('2nd SDF is labelled a tooth count', tcl.includes('2nd Silver Diamine Fluoride App (tooth count)'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};
run().catch((e) => { console.error(e); process.exit(1); });
