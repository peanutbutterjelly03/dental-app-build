// Sprint 84 — the Target Client List reconciled against the SOURCE WORKBOOK.
//
// The captions below are transcribed from TCLForm2andFHSISReport.xlsx, sheet
// "6-9 Y.O (M)", columns B-BN — the authoritative DOH file the user supplied,
// which replaces the illegible Appendix E scan every earlier sprint worked
// from. Read-only: creates nothing.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

// The 20 ORAL HEALTH STATUS columns (workbook N-AG) the app had none of.
const STATUS = [
  'With Caries experience',
  'With Caries experience in Temporary Dentition',
  'With Caries experience in Permanent Dentition',
  '5 Year Old with Permanent Dentition',
  'With Active Dental Caries',
  'Gum/Perio Disease',
  'Oral Debris',
  'Calcular Deposits',
  'Dento-Facial Anomaly',
  'Completely Edentulous / No Dentition',
  'Sound Temporary Tooth/Teeth',
  'Sound Permanent Tooth/Teeth',
  'Caries Free',
];

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

  console.log(`\nSprint 84 verification against ${BASE}\n`);

  const head = await page.innerText('table thead');

  check('ORAL HEALTH STATUS band present', /ORAL HEALTH STATUS/i.test(head));
  for (const label of STATUS) check(`status column: ${label}`, head.includes(label), '');

  // ── Corrections the workbook settles ─────────────────────────────────────
  check('"Oral Hygiene Instruction" removed (not in the workbook)', !head.includes('Oral Hygiene Instruction'));
  check('"Removal of Plaque / Calculus" removed (not in the workbook)', !head.includes('Removal of Plaque'));
  check('Composite Filling is a TOOTH COUNT, as the workbook has it',
    head.includes('Composite Filling (Tooth Count)'));
  check('ART carries the workbook caption',
    head.includes('ART/Glass Ionomer Filling (Tooth Count)'));
  check('Extraction is a TOOTH COUNT', head.includes('Extraction (Tooth Count)'));
  check('SDF has BOTH a 1st and a 2nd tooth-count column',
    head.includes('1st Silver Diamine Fluoride App (tooth count)') && head.includes('2nd Silver Diamine Fluoride App (tooth count)'));

  // Sprint 82 accidentally produced two Temporary Filling columns.
  const tfCount = (head.match(/Temporary Filling/g) || []).length;
  check('exactly ONE Temporary Filling column (Sprint 82 duplicated it)', tfCount === 1, `found ${tfCount}`);

  // ── Column count matches the workbook ────────────────────────────────────
  // Workbook: 66 columns, of which A is a spacer and there is no Sex column
  // (each sheet IS one sex). This single table substitutes Sex for the spacer,
  // so the totals coincide at 66.
  const leaves = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table thead tr')];
    return rows[rows.length - 1].querySelectorAll('th').length;
  });
  check('66 leaf columns, matching the workbook', leaves === 66, `got ${leaves}`);

  // ── Structural integrity of the grouped header ───────────────────────────
  const bandTotal = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table thead tr')];
    const groupRow = rows.find((r) => /ORAL HEALTH STATUS/i.test(r.innerText));
    if (!groupRow) return null;
    return [...groupRow.querySelectorAll('th')].reduce((n, th) => n + (th.colSpan || 1), 0);
  });
  check('group bands span exactly the leaf columns', bandTotal === leaves, `${bandTotal} vs ${leaves}`);

  // ── Rows still line up after 16 new columns ──────────────────────────────
  await page.click('button:has-text("Annual")');
  await page.fill('input[type="date"]', '2026-03-02');
  await page.waitForTimeout(1500);
  const cells = await page.evaluate(() => {
    const tr = document.querySelector('table tbody tr');
    return tr ? tr.querySelectorAll('td').length : 0;
  });
  check('every body row has one cell per leaf column', cells === leaves, `${cells} vs ${leaves}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
