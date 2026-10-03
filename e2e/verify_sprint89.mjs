// Sprint 89 — the Program Report's section C rebuilt against the FILED form.
//
// Source of truth is the signed January 2026 return, not Appendix F and not
// the DOH workbook's "2026 Form 2" sheet (a different form with a different
// row set). These checks therefore assert the filed form's exact captions,
// including its own wording — "Calcular", "Sealants", "Number of patient given
// Root Surface Protection" — and the two rows that were removed for not being
// on it.
//
// Read-only: creates nothing.
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

  // ⚠ Pick the school year the ROSTER is on. The picker defaults to the
  // CURRENT school year, and the demo records sit on 2025-2026 — so the
  // default view is legitimately all zeros, and asserting real numbers against
  // it would fail for a reason that has nothing to do with this sprint.
  const yearSelect = page.locator('select').filter({ hasText: 'All years to date' }).first();
  await yearSelect.selectOption('2025-2026');
  await page.waitForTimeout(1500);

  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3000);

  console.log(`\nSprint 89 verification against ${BASE}\n`);

  const body = await page.innerText('table');

  // ── Section bands, as the form letters them ─────────────────────────────
  check('section A is "Patient Seeking Behaviour", not "Utilization"',
    /A\.\s*Patient Seeking Behaviour/i.test(body) && !/Patient Seeking Utilization/i.test(body));
  check('the fourth band is "Other Procedures" and carries NO letter',
    /Other Procedures/i.test(body) && !/D\.\s*Other Parameters/i.test(body));

  // ── Section C: every indicator on the filed form ────────────────────────
  for (const label of [
    'Number of patients Examined / given Oral Examination',
    'Number of patients provided with Oral Health Counselling',
    'Number of patients given OP / Scaling',
    'Number of patients given Fluoride Varnish',
    'Number of patients given Silver Diamine Fluoride (SDF)',
    'Number of patients given ART',
    'Number of patients given Sealants',
    'Number of patient given Root Surface Protection',
    'Number of patients who had Tooth Extraction',
  ]) check(`section C row: ${label}`, body.includes(label));

  // ── Rows that are NOT on the filed form ─────────────────────────────────
  check('"Permanent Filling" removed — not on the filed form', !/Permanent Filling/i.test(body));
  check('ART no longer split by Glass Ionomer / Composite',
    !/Glass Ionomer/i.test(body) && !/Composite/i.test(body));

  // ── The form's own sub-row structure ────────────────────────────────────
  const structure = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('tbody tr')) {
      const tds = [...tr.querySelectorAll('td')];
      if (!tds.length) continue;
      out.push({
        first: tds[0].textContent.trim(),
        second: tds[1] ? tds[1].textContent.trim() : '',
        firstSpan: Number(tds[0].getAttribute('rowspan') || 1),
        firstColSpan: Number(tds[0].getAttribute('colspan') || 1),
        cells: tds.length,
      });
    }
    return out;
  });

  const parent = (label) => structure.find((r) => r.first === label);
  for (const label of [
    'Number of patients given OP / Scaling',
    'Number of patients given Fluoride Varnish',
    'Number of patients given Silver Diamine Fluoride (SDF)',
    'Number of patients given ART',
    'Number of patients given Sealants',
    'Number of patient given Root Surface Protection',
    'Number of patients who had Tooth Extraction',
  ]) {
    const p = parent(label);
    check(`${label}: label spans its two sub-rows, as printed`,
      p !== undefined && p.firstSpan === 2, p ? `rowspan ${p.firstSpan}` : 'row not found');
  }

  check('OP / Scaling splits into 1st and 2nd Scaling',
    body.includes('1st Scaling') && body.includes('2nd Scaling'));
  check('Fluoride Varnish and SDF each split into 1st / 2nd Application',
    (body.match(/1st Application/g) ?? []).length >= 2 && (body.match(/2nd Application/g) ?? []).length >= 2);
  check('four indicators split into Head Count / Tooth Count',
    (body.match(/Head Count/g) ?? []).length === 4 && (body.match(/Tooth Count/g) ?? []).length === 4,
    `${(body.match(/Head Count/g) ?? []).length} head / ${(body.match(/Tooth Count/g) ?? []).length} tooth`);

  // Sub-rows must NOT be collapsible — a foldable row could file a form with a
  // missing line, which is the whole reason the old `children` model went.
  check('sub-rows are not collapsible (no disclosure buttons left in the table)',
    (await page.locator('table button[aria-expanded]').count()) === 0);

  // ── A plain row spans BOTH label columns, as the form does ──────────────
  const plain = parent('Number of patients with Gingivitis');
  check('a plain indicator spans both label columns',
    plain !== undefined && plain.firstColSpan === 2, plain ? `colspan ${plain.firstColSpan}` : 'row not found');

  // ── Other Procedures: the four rows that were missing ───────────────────
  for (const label of [
    'a. No. of patients for Oral Cancer Screening Referrals',
    'b. No. of patients for Surgical Procedures',
    'c. No. of Referrals to Private Facilities',
    'No. of patients given Dental Prescriptions',
  ]) check(`Other Procedures row: ${label}`, body.includes(label));
  check('"Higher Level of Care" caption matches the form (no stray "a")',
    body.includes('Total no. of patients referred to Higher Level of Care'));

  // ── Caption corrections read off the filed return ───────────────────────
  check('"Calcular Deposits", the form\'s own spelling', body.includes('Oral Debris / Calcular Deposits'));
  check('"w/ suspected oral lesions", as printed', body.includes('Number of patients w/ suspected oral lesions'));

  // ── Nothing regressed: section B still reports real numbers ─────────────
  const cariesRow = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tbody tr')]
      .find((r) => r.querySelector('td')?.textContent.trim() === 'Number of patients with Dental Caries');
    if (!tr) return null;
    return [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent.trim());
  });
  check('Dental Caries still carries real values, not dashes',
    cariesRow !== null && cariesRow.some((v) => /^\d+$/.test(v) && Number(v) > 0), JSON.stringify(cariesRow));

  // ── Exports still work through the new row model ────────────────────────
  for (const [label, ext] of [['PDF', '.pdf'], ['Excel', '.xlsx']]) {
    const wait = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.click(`button:has-text("${label}")`);
    const dl = await wait;
    check(`${label} export still downloads`, dl !== null && dl.suggestedFilename().endsWith(ext),
      dl ? dl.suggestedFilename() : 'no download');
    await page.waitForTimeout(500);
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
