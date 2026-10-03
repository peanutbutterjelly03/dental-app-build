// Sprint 83 — the Program Report gains the paper form's missing rows, and the
// DOH tables adopt the printed form's section band and blocked-cell shading.
//
// Read-only: creates nothing.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const SHOTS = process.argv[3] || '.';
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
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3000);

  console.log(`\nSprint 83 verification against ${BASE}\n`);

  const body = await page.innerText('table');

  // ── Section A: the whole section was missing ─────────────────────────────
  // ⚠ Captions below were CORRECTED in Sprint 89 against the FILED January
  // 2026 return — "Behaviour" not "Utilization", a hyphen not an em dash in
  // the RPOC rows, "Calcular" not "Calculus", and an UNLETTERED "Other
  // Procedures" band. The rows and the merge THIS sprint introduced are
  // unchanged; only the wording moved to the paper's own.
  check('section A band present, lettered as the form does', /A\.\s*Patient Seeking Behaviour/i.test(body));
  for (const label of [
    'visited the DENTAL FACILITY for the 1st time',
    'visited NON-FACILITY for the 1st time',
    'RPOC) - 1ST VISIT',
    'RPOC) - 2ND VISIT',
  ]) check(`section A row present: ${label}`, body.includes(label));

  // ── Sections relettered B/C/D ────────────────────────────────────────────
  check('sections are lettered B and C, with Other Procedures unlettered as printed',
    /B\.\s*Oral Health Status/i.test(body) && /C\.\s*Services Rendered/i.test(body) && /Other Procedures/i.test(body));

  // ── Section B additions and the merge ────────────────────────────────────
  check('Periodontitis row added', body.includes('Periodontitis'));
  check('Completely Edentulous row added', /Completely Edentulous/i.test(body));
  check('OFC Upon Complete Oral Rehabilitation row added', /OFC Upon Complete Oral Rehabilitation/i.test(body));
  check('Oral Debris / Calculus is ONE merged row, as printed',
    body.includes('Oral Debris / Calcular Deposits'));
  check('the two separate debris and calculus rows are gone',
    !/Number of patients with Oral Debris\n/.test(body) && !/with Calcular Deposits/.test(body.replace('Oral Debris / Calcular Deposits', '')));

  // ── Section A must carry REAL numbers, not dashes ────────────────────────
  // The facility rows read Sprint 81's flag; the RPOC rows read visit numbers,
  // which the seeded data has, so the grand total must be a number.
  const rpocTotal = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table tbody tr')]
      .find((r) => r.innerText.includes('RPOC) - 1ST VISIT'));
    if (!tr) return null;
    const tds = tr.querySelectorAll('td');
    return tds[tds.length - 1].innerText.trim();
  });
  check('RPOC 1st-visit row shows a real total, not "—"',
    rpocTotal !== null && rpocTotal !== '—' && /^\d+$/.test(rpocTotal), `got ${JSON.stringify(rpocTotal)}`);

  // ── Blocked cells are shaded and EMPTY, not dashed ───────────────────────
  const blocked = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table tbody tr')]
      .find((r) => /Completely Edentulous/i.test(r.innerText));
    if (!tr) return null;
    const tds = [...tr.querySelectorAll('td')].slice(1);
    const bg = getComputedStyle(tds[0]).backgroundColor;
    return { bg, text: tds.map((t) => t.innerText.trim()).join(''), n: tds.length };
  });
  check('blocked row cells are dark-shaded', blocked && /rgb\(86,\s*86,\s*86\)/.test(blocked.bg), blocked?.bg);
  check('blocked cells are EMPTY (a dash would invite a number)', blocked && blocked.text === '', JSON.stringify(blocked?.text));

  // ── Section bands carry the form's amber ─────────────────────────────────
  const bandBg = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table tbody tr')]
      .find((r) => /A\.\s*Patient Seeking Behaviour/i.test(r.innerText));
    return tr ? getComputedStyle(tr.querySelector('td')).backgroundColor : null;
  });
  check('section band is the form amber, not a pale tint',
    bandBg !== null && /rgb\(245,\s*200,\s*66\)/.test(bandBg), bandBg);

  await page.screenshot({ path: `${SHOTS}/sprint83-program-report.png`, fullPage: true });

  // ── FHSIS uses the same band ─────────────────────────────────────────────
  await page.click('button:has-text("FHSIS")');
  await page.waitForTimeout(2500);
  const fhsisBand = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('table tbody tr')]
      .find((r) => /1st visit|completed 2 visits/i.test(r.innerText) && r.querySelectorAll('td').length <= 2);
    return tr ? getComputedStyle(tr.querySelector('td')).backgroundColor : null;
  });
  check('FHSIS section band uses the shared form amber',
    fhsisBand !== null && /rgb\(245,\s*200,\s*66\)/.test(fhsisBand), fhsisBand);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
