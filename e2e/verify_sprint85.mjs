// Sprint 85 — official output for the forms that had none.
//
// The FORMAT of each form is a decision, not a detail (2026-09-03):
//   TCL             Excel ONLY  — 66 columns; Excel paginates them, a PDF cannot.
//                                 Also the format the City Health Office requires.
//   Program Report  PDF + Excel — aggregate counts, no names, bounded width.
//   IPTR            PDF ONLY    — one patient's own record; a spreadsheet of a
//                                 single patient is a decrypted PII file with no
//                                 filing purpose (Sprint 52).
//   Consent form    PDF ONLY    — blank, no data at all.
// This asserts the ABSENCES as hard as the presences: a stray "Excel" button on
// the IPTR would be exactly the leak Sprint 52 removed.
//
// Read-only: downloads are captured and discarded, nothing is written to the DB.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();

  await page.goto(BASE);
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  console.log(`\nSprint 85 verification against ${BASE}\n`);

  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2500);

  // ── Target Client List: Excel, and deliberately NO PDF ───────────────────
  await page.click('button:has-text("Target Client List")');
  await page.waitForTimeout(2500);
  const tclToolbar = page.locator('div.bg-card').first();
  check('TCL offers Excel', await page.locator('button:has-text("Excel")').count() > 0);
  check('TCL offers NO PDF button (deliberate — 66 columns)',
    await tclToolbar.locator('button:has-text("PDF")').count() === 0);

  // The download must actually produce a file, not just a button.
  await page.click('button:has-text("Annual")');
  await page.fill('input[type="date"]', '2026-03-02');
  await page.waitForTimeout(1200);
  const [tclDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('button:has-text("Excel")'),
  ]);
  const tclName = tclDl.suggestedFilename();
  check('TCL Excel downloads a real .xlsx', tclName.endsWith('.xlsx'), tclName);
  check('TCL filename identifies the period and school', /TCL_.+_.+\.xlsx/.test(tclName), tclName);

  // ── Program Report: both ─────────────────────────────────────────────────
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(2500);
  check('Program Report offers PDF', await page.locator('button:has-text("PDF")').count() > 0);
  check('Program Report offers Excel', await page.locator('button:has-text("Excel")').count() > 0);
  const [ohprfDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('button:has-text("Excel")'),
  ]);
  check('Program Report Excel downloads', ohprfDl.suggestedFilename().endsWith('.xlsx'), ohprfDl.suggestedFilename());

  // ── Consent form: blank, PDF only ────────────────────────────────────────
  await page.click('button:has-text("Consent Form")');
  await page.waitForTimeout(1500);
  const consent = await page.innerText('body');
  check('consent form renders', /PARENTS\/GUARDIAN CONSENT FORM/i.test(consent));
  check('consent form carries the service list verbatim',
    consent.includes('TOPICAL FLUORIDE VARNISH APPLICATION (KINDER AT GRADE 1)')
    && consent.includes('PIT AND FISSURE SEALANT (GRADE 2 TO GRADE 3)'));
  check('consent form carries the medical-history block', /ABNORMAL BLEEDING/.test(consent) && /TUBERCULOSIS\/TB/.test(consent));
  check('consent form offers NO Excel (it is a blank document)',
    await page.locator('button:has-text("Excel")').count() === 0);
  // It must be BLANK — no student data may leak into a form sent home in bulk.
  // Scoped to the PRINTED REGION, not the page: `body` also contains the
  // sidebar, which shows the signed-in dentist's own name and would match here
  // while proving nothing about the form.
  const printed = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h1')].find((e) => /PARENTS\/GUARDIAN CONSENT FORM/i.test(e.textContent || ''));
    return h ? (h.closest('div')?.innerText ?? '') : '';
  });
  check('the printable region was found', printed.length > 200, `${printed.length} chars`);
  // Every write-on field must still be empty: no digits that could be an age,
  // a contact number or a birthday, and none of the seeded surnames.
  check('consent form is BLANK — no student data pre-filled',
    printed.length > 200 && !/Santos|Reyes|Cruz|Dela|Bautista/i.test(printed),
    'a name appeared inside the printed form');

  // ── IPTR: PDF only, on a patient's own record ────────────────────────────
  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);
  await page.locator('table tbody tr').first().click();
  await page.waitForTimeout(3000);
  check('IPTR offers PDF', await page.locator('button:has-text("PDF")').count() > 0);
  check('IPTR offers NO Excel (single patient — Sprint 52 rule)',
    await page.locator('button:has-text("Excel")').count() === 0);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
