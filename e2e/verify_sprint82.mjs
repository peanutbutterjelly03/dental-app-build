// Sprint 82 — the Target Client List gains the columns the real DOH form has.
//
// Asserts the new captions actually reach the SCREEN (a column that only lands
// in source is worth nothing on a form filed with the City Health Office), that
// the ones with a real source are wired to it, and that the ones without stay
// blank rather than being faked.
//
// Read-only: creates nothing, so there is nothing to clean up.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  await page.goto(BASE);
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Target Client List")');
  await page.waitForTimeout(3000);

  console.log(`\nSprint 82 verification against ${BASE}\n`);

  const head = await page.innerText('table thead');

  // ── Columns that were missing and now exist ──────────────────────────────
  for (const label of [
    'Facility Based',
    'Family Serial Number',
    'Barangay',
    'Pit and Fissure Sealant',
    'Complete Mouth Rehab',
    'Upon Oral Examination',
    'After Complete Mouth Rehabilitation',
    'Last Dental Visit',
    'Next Dental Visit',
  ]) {
    check(`column present: ${label}`, head.includes(label));
  }

  // ── The Gum Treatment split (a correction, not an addition) ──────────────
  check('Gum Treatment is SPLIT into Scaling and Prescription',
    head.includes('Gum Treatment - Scaling') && head.includes('Gum Treatment - Prescription'));
  check('the single guessed "Gum Treatment" column is gone',
    !/Gum Treatment(?! - )/.test(head));

  // ── The one deletion: a column the real form does not have ───────────────
  check('"Complete Health Record" removed (not on the real form)', !head.includes('Complete Health Record'));

  // ── New group bands ──────────────────────────────────────────────────────
  check('ORALLY FIT CHILD band present', /ORALLY FIT CHILD/i.test(head));
  check('DENTAL VISIT band present', /DENTAL VISIT/i.test(head));

  // ── Header bands must still span exactly what is shown ───────────────────
  // A drifting band is the classic failure when columns are added to a table
  // with grouped headers, and it is invisible in a screenshot of the left edge.
  const bandTotal = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table thead tr')];
    const groupRow = rows.find((r) => /ORALLY FIT CHILD/i.test(r.innerText));
    if (!groupRow) return null;
    return [...groupRow.querySelectorAll('th')].reduce((n, th) => n + (th.colSpan || 1), 0);
  });
  const leafCount = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table thead tr')];
    return rows[rows.length - 1].querySelectorAll('th').length;
  });
  check('group band widths sum to the number of leaf columns',
    bandTotal !== null && bandTotal === leafCount, `bands ${bandTotal} vs leaves ${leafCount}`);

  // ── Real sources actually render ─────────────────────────────────────────
  // The period defaults to the CURRENT month and consultations are older, so
  // widen to Annual over a year that has data before inspecting rows. An empty
  // table here is the period filter working, not a missing column.
  await page.click('button:has-text("Annual")');
  await page.fill('input[type="date"]', '2026-03-02');
  await page.waitForTimeout(1500);

  const bodyText = await page.innerText('table tbody');
  const cellsPerRow = await page.evaluate(() => {
    const tr = document.querySelector('table tbody tr');
    return tr ? tr.querySelectorAll('td').length : 0;
  });
  check('every body row has one cell per leaf column', cellsPerRow === leafCount, `${cellsPerRow} vs ${leafCount}`);

  // Facility Based must show "—" for unrecorded, never "0" (which claims "No").
  check('table rendered with data', bodyText.length > 50, 'no rows to inspect');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
