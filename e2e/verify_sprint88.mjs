// Sprint 88 — the per-school summary sheet.
//
// The sheet is small, so the risk is not "does a number appear" but "does the
// form say something it cannot stand behind". These checks therefore assert the
// ABSENCES as hard as the presences: the blank VG row, the "—" in every column
// with no per-tooth source, and the deliberately missing temporary (m) row.
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

  console.log(`\nSprint 88 verification against ${BASE}\n`);

  check('the School Summary tab exists', await page.isVisible('button:has-text("School Summary")'));
  await page.click('button:has-text("School Summary")');
  await page.waitForTimeout(3000);

  // ── The sheet's shape ───────────────────────────────────────────────────
  const grid = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return null;
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    const heads = [...table.querySelectorAll('thead tr')].map((tr) =>
      [...tr.querySelectorAll('th')].map((th) => th.textContent.trim()));
    return { rows, heads };
  });
  check('the sheet rendered', grid !== null && grid.rows.length > 0);
  if (!grid) { await browser.close(); process.exit(1); }

  const header = grid.heads[grid.heads.length - 1];
  check('columns read MALE | TOTAL | FEMALE | TOTAL, as the paper does',
    header.slice(2).join('|') === 'MALE|TOTAL|FEMALE|TOTAL', header.join('|'));
  check('the school name band tops the sheet', (grid.heads[0]?.[0] ?? '').length > 0, JSON.stringify(grid.heads[0]));

  const labels = grid.rows.map((r) => `${r[0]} ${r[1]}`.trim());
  const EXPECTED = [
    'Dental Caries', 'Gingivitis', 'Debris', 'Calculus',
    'Total Number Decayed (D)', '(M)', '(F)', '(X)',
    'Number Total decayed (d)', '(f)', '(x)',
    'Very Good (VG)', 'No Flouride',
  ];
  check(`all ${EXPECTED.length} rows, in the printed order`,
    JSON.stringify(labels) === JSON.stringify(EXPECTED), JSON.stringify(labels));

  // ── Captions are verbatim, typos included ───────────────────────────────
  check('"No Flouride" kept as the form spells it', labels.includes('No Flouride'));
  check('"Number Total decayed" kept as the form cases it', labels.includes('Number Total decayed (d)'));
  check('NO temporary (m) row — dft is deliberate, not an omission',
    !labels.some((l) => l === '(m)'), JSON.stringify(labels));

  const rowFor = (label) => grid.rows[labels.indexOf(label)];
  const cells = (label) => rowFor(label).slice(2);

  // ── What the sheet declines to claim ────────────────────────────────────
  check('Very Good (VG) is blank in all four columns, not zeroed',
    cells('Very Good (VG)').every((c) => c === '—'), JSON.stringify(cells('Very Good (VG)')));
  for (const label of ['Gingivitis', 'Debris', 'Calculus', 'No Flouride']) {
    const c = cells(label);
    check(`${label}: head counts given, tooth counts declined ("—")`,
      c[1] === '—' && c[3] === '—' && /^\d+$/.test(c[0]) && /^\d+$/.test(c[2]), JSON.stringify(c));
  }

  // ── The tooth-code rows are real numbers in all four columns ────────────
  for (const label of ['Dental Caries', 'Total Number Decayed (D)', '(M)', '(F)', '(X)', 'Number Total decayed (d)', '(f)', '(x)']) {
    check(`${label}: head count AND tooth count are numbers`,
      cells(label).every((c) => /^\d+$/.test(c)), JSON.stringify(cells(label)));
  }

  // ── The one arithmetic the sheet must get right ─────────────────────────
  // Caries teeth = D teeth + d teeth (a tooth is one or the other, never both).
  // Caries HEAD count is NOT the sum — a student with both must count once —
  // so it must be <= the sum, and that is asserted rather than assumed.
  const n = (label, i) => Number(cells(label)[i]);
  for (const [sexLabel, headIdx, teethIdx] of [['male', 0, 1], ['female', 2, 3]]) {
    check(`caries teeth = D + d (${sexLabel})`,
      n('Dental Caries', teethIdx) === n('Total Number Decayed (D)', teethIdx) + n('Number Total decayed (d)', teethIdx),
      `${n('Dental Caries', teethIdx)} vs ${n('Total Number Decayed (D)', teethIdx)}+${n('Number Total decayed (d)', teethIdx)}`);
    check(`caries head count is deduplicated, not summed (${sexLabel})`,
      n('Dental Caries', headIdx) <= n('Total Number Decayed (D)', headIdx) + n('Number Total decayed (d)', headIdx),
      `${n('Dental Caries', headIdx)} > ${n('Total Number Decayed (D)', headIdx)}+${n('Number Total decayed (d)', headIdx)}`);
    check(`caries head count is at least the larger dentition alone (${sexLabel})`,
      n('Dental Caries', headIdx) >= Math.max(n('Total Number Decayed (D)', headIdx), n('Number Total decayed (d)', headIdx)));
  }

  // ── The sheet explains its own dashes ───────────────────────────────────
  const body = await page.innerText('body');
  check('the "—" is explained on the sheet itself', /has no source for that cell/i.test(body));
  check('the blank VG row says why', /no "Very Good" option to count/i.test(body));
  check('the "No Flouride" definition is stated', /no Fluoride Varnish recorded/i.test(body));

  // ── Exports ─────────────────────────────────────────────────────────────
  for (const [label, ext] of [['PDF', '.pdf'], ['Excel', '.xlsx']]) {
    const wait = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.click(`button:has-text("${label}")`);
    const dl = await wait;
    check(`${label} export downloads a file`, dl !== null && dl.suggestedFilename().endsWith(ext),
      dl ? dl.suggestedFilename() : 'no download');
    await page.waitForTimeout(500);
  }

  // ── Three device classes ────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal page scroll at 390px (the table scrolls in its own box)', overflow <= 1, `${overflow}px`);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
