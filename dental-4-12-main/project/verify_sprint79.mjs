// Sprint 79 — FHSIS Section D (school-level).
//
// The assertion that matters is NOT that the table renders. It is that the
// numbers equal what the database says, and that the month picker CHANGES them
// -- a period selector that filters nothing is exactly the cosmetic control
// CLAUDE.md forbids, and the DOH School filter shipped that way once already
// (Sprint 59). So this recomputes the expected counts independently from the
// API, then reads them back off the rendered page.
//
// Usage: node verify_sprint79.mjs [baseUrl] [apiBase]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:4000';
let cookie = '';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
async function api(path) {
  const res = await fetch(`${API}/api${path}`, { headers: { cookie } });
  return res.json();
}
const ageAt = (birthday, on) => {
  const b = new Date(birthday);
  let a = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) a -= 1;
  return a;
};
const BANDS = [
  ['infants', 0, 0], ['children1to4', 1, 4], ['children5to9', 5, 9],
  ['adolescents', 10, 19], ['adults', 20, 59], ['seniors', 60, 200],
];
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const run = async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  if (!login.ok) { console.error(`login failed ${login.status}`); process.exit(1); }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  const [students, iptrs, pcrs] = await Promise.all([
    api('/students'), api('/student-iptrs'), api('/preventive-care-records'),
  ]);
  const studentById = new Map(students.map((s) => [s._id, s]));
  const iptrById = new Map(iptrs.map((i) => [i._id, i]));

  // Independent recomputation, all schools.
  const firstVisit = new Map();
  for (const p of pcrs) {
    if (p.visit_number !== 1) continue;
    const d = new Date(p.visit_date);
    const prev = firstVisit.get(p.iptr_id);
    if (!prev || d < prev) firstVisit.set(p.iptr_id, d);
  }
  const expect = {};
  const monthTotals = {};
  for (const p of pcrs) {
    const when = new Date(p.visit_date);
    const iptr = iptrById.get(p.iptr_id);
    const st = iptr && studentById.get(iptr.student_id);
    if (!st) continue;
    const sexRaw = (st.sex ?? '').toLowerCase();
    const sex = sexRaw.startsWith('m') ? 'male' : sexRaw.startsWith('f') ? 'female' : null;
    const age = ageAt(st.birthday, when);
    const band = BANDS.find(([, lo, hi]) => age >= lo && age <= hi);
    if (!sex || !band) continue;
    const key = ym(when);
    let measure = null;
    if (p.visit_number === 1) measure = 'first';
    else {
      const v1 = firstVisit.get(p.iptr_id);
      if (v1) {
        const yearBefore = new Date(when); yearBefore.setFullYear(yearBefore.getFullYear() - 1);
        if (v1 >= yearBefore) measure = 'completed';
      }
    }
    if (!measure) continue;
    expect[key] ??= {};
    expect[key][`${band[0]}.${measure}.${sex}`] = (expect[key][`${band[0]}.${measure}.${sex}`] ?? 0) + 1;
    monthTotals[key] = (monthTotals[key] ?? 0) + 1;
  }

  const monthsWithData = Object.keys(monthTotals).sort();
  console.log(`\nSprint 79 verification against ${BASE}`);
  console.log(`  ${pcrs.length} preventive-care records; months with countable visits: ${monthsWithData.join(', ') || '(none)'}\n`);
  check('there is at least one month of visit data to verify against', monthsWithData.length > 0);
  if (monthsWithData.length === 0) { console.log('\nCannot verify counts with no data.'); process.exit(1); }

  const target = monthsWithData.sort((a, b) => (monthTotals[b] - monthTotals[a]))[0];
  const expTotal = monthTotals[target];
  console.log(`  richest month: ${target} (${expTotal} countable visits)\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2500);

  await page.click('button:has-text("FHSIS")');
  await page.waitForTimeout(2500);
  const body = await page.innerText('body');
  check('the FHSIS tab opens', body.includes('SECTION D. ORAL HEALTH CARE SERVICES'));
  check('it shows both halves of the form', body.includes('FIRST VISIT TO AN ORAL HEALTH CARE PROFESSIONAL') && body.includes('COMPLETED 2 VISITS'));
  check('the school-level header band is present', body.includes('School:') && body.includes('Month:'));
  check('rows with no source are blank, not zero', body.includes('not recorded'));
  check('the pregnant-women block is still on the form', body.includes('PREGNANT WOMEN'));

  // Set the month to the richest one and total the rendered Total column.
  await page.fill('#fhsis-month', target);
  await page.waitForTimeout(2000);

  const readTotals = async () =>
    page.$$eval('table tbody tr', (rows) =>
      rows.map((r) => {
        const tds = [...r.querySelectorAll('td')];
        if (tds.length < 4) return null;
        const label = tds[0].innerText.trim();
        const total = tds[3].innerText.trim();
        return { label, total };
      }).filter(Boolean),
    );

  const rowsAt = await readTotals();
  const numeric = rowsAt.filter((r) => /^\d+$/.test(r.total));
  const renderedSum = numeric.reduce((a, r) => a + Number(r.total), 0);
  console.log(`        rendered numeric rows: ${numeric.length}, summing to ${renderedSum}; expected ${expTotal}`);
  check('the rendered totals equal the database count for that month', renderedSum === expTotal, `${renderedSum} vs ${expTotal}`);

  const dashRows = rowsAt.filter((r) => r.total === '—');
  check('facility / pregnancy rows render as “—” rather than 0', dashRows.length > 0, `${dashRows.length}`);

  // A month with NO visits must go to zero — proving the picker filters data.
  await page.fill('#fhsis-month', '2019-01');
  await page.waitForTimeout(2000);
  const emptyRows = await readTotals();
  const emptySum = emptyRows.filter((r) => /^\d+$/.test(r.total)).reduce((a, r) => a + Number(r.total), 0);
  check('THE MONTH PICKER ACTUALLY FILTERS (empty month totals 0)', emptySum === 0, `got ${emptySum}`);
  check('the form still renders all its rows in an empty month', emptyRows.length === rowsAt.length, `${emptyRows.length} vs ${rowsAt.length}`);

  // ── exports (Sprint 79b) ────────────────────────────────────────────────
  // A download that throws still "clicks" fine, so assert a real file arrives.
  await page.fill('#fhsis-month', target);
  await page.waitForTimeout(1500);
  const fs = await import('node:fs');
  for (const [label, ext] of [['PDF', 'pdf'], ['Excel', 'xlsx']]) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.click(`button:has-text("${label}")`),
      ]);
      const name = download.suggestedFilename();
      const path = await download.path();
      const size = path ? fs.statSync(path).size : 0;
      check(`${label} export downloads a non-empty file`, size > 1000, `${name} ${size}B`);
      check(`${label} filename carries the month`, name.includes(target) && name.endsWith(`.${ext}`), name);
    } catch (e) {
      check(`${label} export downloads a non-empty file`, false, String(e).slice(0, 90));
    }
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
