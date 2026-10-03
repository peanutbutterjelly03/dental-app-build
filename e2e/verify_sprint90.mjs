// Sprint 90 — Services Rendered wired to real numbers.
//
// The risk in this sprint is not "is a number shown" but "is it the RIGHT
// KIND of number". Three distinctions have to hold, and each is asserted
// against the live data rather than assumed:
//   · head count vs tooth count — a patient with four sealants is 1 head and
//     4 teeth, so tooth >= head for every service that reports both,
//   · 1st vs 2nd application — 2nd can never exceed 1st, because a 2nd
//     sitting implies a 1st,
//   · rows with NO source must still print "—". Counselling and Root Surface
//     Protection have no treatment code, and a 0 there would be a claim.
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
  // The picker defaults to the CURRENT school year; the demo roster is on
  // 2025-2026, so the default view is legitimately all zeros.
  await page.locator('select').filter({ hasText: 'All years to date' }).first().selectOption('2025-2026');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Program Report")');
  await page.waitForTimeout(3500);

  console.log(`\nSprint 90 verification against ${BASE}\n`);

  // Grand total per (parent label, sub-row label) — the last cell of the line.
  const totals = await page.evaluate(() => {
    const out = {};
    let parent = '';
    for (const tr of document.querySelectorAll('tbody tr')) {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < 3) continue;
      const spans = Number(tds[0].getAttribute('rowspan') || 1);
      let sub = '';
      if (spans > 1) { parent = tds[0].textContent.trim(); sub = tds[1].textContent.trim(); }
      else if (Number(tds[0].getAttribute('colspan') || 1) === 2) { parent = tds[0].textContent.trim(); }
      else { sub = tds[0].textContent.trim(); }
      out[sub ? `${parent} :: ${sub}` : parent] = tds[tds.length - 1].textContent.trim();
    }
    return out;
  });
  const num = (k) => { const v = totals[k]; return v !== undefined && /^\d+$/.test(v) ? Number(v) : null; };

  // ── The section stopped printing dashes ─────────────────────────────────
  const wired = [
    'Number of patients given OP / Scaling :: 1st Scaling',
    'Number of patients given OP / Scaling :: 2nd Scaling',
    'Number of patients given Fluoride Varnish :: 1st Application',
    'Number of patients given Fluoride Varnish :: 2nd Application',
    'Number of patients given Silver Diamine Fluoride (SDF) :: 1st Application',
    'Number of patients given Silver Diamine Fluoride (SDF) :: 2nd Application',
    'Number of patients given ART :: Head Count',
    'Number of patients given ART :: Tooth Count',
    'Number of patients given Sealants :: Head Count',
    'Number of patients given Sealants :: Tooth Count',
    'Number of patients who had Tooth Extraction :: Head Count',
    'Number of patients who had Tooth Extraction :: Tooth Count',
  ];
  for (const k of wired) check(`wired, not a dash: ${k}`, num(k) !== null, String(totals[k]));

  // ⚠ NO "expect a non-zero" CHECK HERE, AND THAT IS NOT A WEAKER TEST.
  // Verified 2026-09-03 against the live database: ALL 27 tooth records carry
  // only a `condition` — not one has a `treatment_code`. So every Services
  // Rendered figure is legitimately 0, and a "some row is non-zero" assertion
  // could only ever be made to pass by writing junk into the one shared
  // database (Open work 26). The arithmetic is proved below instead, against
  // controlled input, which tests more than a live non-zero ever would.
  check('zeros, not dashes — the section now has a source',
    wired.every((k) => num(k) !== null));

  // ── The arithmetic, on controlled input ─────────────────────────────────
  // Runs the REAL exported tally through Vite's module graph.
  const tally = await page.evaluate(async () => {
    const mod = await import('/src/app/hooks/useDohReportData.ts');
    const charts = [
      { _id: 'c2', iptr_id: 'i1', dentist_id: 'd', date_charted: '2026-03-01', isArchived: false },
      { _id: 'c1', iptr_id: 'i1', dentist_id: 'd', date_charted: '2026-01-01', isArchived: false },
    ];
    const toothByChart = new Map([
      // One sitting, four sealants and one extraction.
      ['c1', [
        { _id: 't1', chart_id: 'c1', tooth_number: 16, condition: 'D', treatment_code: 'PFS' },
        { _id: 't2', chart_id: 'c1', tooth_number: 26, condition: 'D', treatment_code: 'PFS' },
        { _id: 't3', chart_id: 'c1', tooth_number: 36, condition: 'D', treatment_code: 'PFS' },
        { _id: 't4', chart_id: 'c1', tooth_number: 46, condition: 'D', treatment_code: 'PFS' },
        { _id: 't5', chart_id: 'c1', tooth_number: 11, condition: 'D', treatment_code: 'X' },
        { _id: 't6', chart_id: 'c1', tooth_number: 12, condition: 'D' },
      ]],
      // A later sitting: a second fluoride, and a sealant the first visit also had.
      ['c2', [
        { _id: 't7', chart_id: 'c2', tooth_number: 21, condition: '', treatment_code: 'FV' },
        { _id: 't8', chart_id: 'c2', tooth_number: 22, condition: '', treatment_code: 'PFS' },
      ]],
    ]);
    return mod.tallyIptrServices(charts, toothByChart);
  });

  check('teeth are counted in full (5 sealants across two sittings)', tally.teethByCode.PFS === 5,
    JSON.stringify(tally.teethByCode));
  check('four sealants in ONE visit is ONE application, not four',
    tally.sittingsByCode.PFS === 2, `sittings ${tally.sittingsByCode.PFS}`);
  check('a service in only one sitting has exactly one sitting',
    tally.sittingsByCode.X === 1 && tally.teethByCode.X === 1, JSON.stringify(tally.sittingsByCode));
  check('a tooth with no treatment_code is not counted as a service',
    tally.teethByCode[''] === undefined && tally.teethByCode['(none)'] === undefined
      && Object.values(tally.teethByCode).reduce((a, b) => a + b, 0) === 7,
    JSON.stringify(tally.teethByCode));
  check('FV recorded only at the later sitting counts once', tally.sittingsByCode.FV === 1);

  // ── Head vs tooth ───────────────────────────────────────────────────────
  for (const svc of ['Number of patients given ART', 'Number of patients given Sealants', 'Number of patients who had Tooth Extraction']) {
    const head = num(`${svc} :: Head Count`);
    const tooth = num(`${svc} :: Tooth Count`);
    check(`${svc}: tooth count >= head count`, head !== null && tooth !== null && tooth >= head, `${tooth} teeth / ${head} heads`);
  }

  // ── 1st vs 2nd ──────────────────────────────────────────────────────────
  for (const [svc, a, b] of [
    ['Number of patients given OP / Scaling', '1st Scaling', '2nd Scaling'],
    ['Number of patients given Fluoride Varnish', '1st Application', '2nd Application'],
    ['Number of patients given Silver Diamine Fluoride (SDF)', '1st Application', '2nd Application'],
  ]) {
    const first = num(`${svc} :: ${a}`);
    const second = num(`${svc} :: ${b}`);
    check(`${svc}: 2nd never exceeds 1st`, first !== null && second !== null && second <= first, `${second} > ${first}`);
  }

  // ── What must STILL decline to answer ───────────────────────────────────
  check('Oral Health Counselling still prints "—" (no treatment code for it)',
    totals['Number of patients provided with Oral Health Counselling'] === '—',
    String(totals['Number of patients provided with Oral Health Counselling']));
  for (const sub of ['Head Count', 'Tooth Count']) {
    const k = `Number of patient given Root Surface Protection :: ${sub}`;
    check(`Root Surface Protection ${sub} still prints "—"`, totals[k] === '—', String(totals[k]));
  }

  // ── Nothing else regressed ──────────────────────────────────────────────
  check('Examined is still real', (num('Number of patients Examined / given Oral Examination') ?? 0) > 0,
    String(totals['Number of patients Examined / given Oral Examination']));
  check('Dental Caries is still real', (num('Number of patients with Dental Caries') ?? 0) > 0,
    String(totals['Number of patients with Dental Caries']));

  // ── Exports carry the new numbers ───────────────────────────────────────
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
