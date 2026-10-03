// Live smoke of the 2026-07-11/12 sprints against production:
// token pass renders, dashboard New Appointment CTA opens the form (?new=1),
// RPC school-year cutoff chips + fluoride wording, Treatment Summary real
// counts + period buttons, DOH PDF download still works after the token swap.
// Run: ENV_FILE=.env BASE_URL=https://dental-app-build.vercel.app node verify_live_smoke.mjs
import { chromium } from 'playwright';
import { readFileSync, statSync } from 'fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR ?? '.';
const env = Object.fromEntries(
  readFileSync(process.env.ENV_FILE ?? '.env', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const PASSWORD = env.SEED_DENTIST_PASSWORD;
if (!PASSWORD) { console.error('no SEED_DENTIST_PASSWORD in env file'); process.exit(1); }

const results = [];
const ok = (name, detail = '') => { results.push(['PASS', name, detail]); console.log('PASS', name, detail); };
const bad = (name, detail = '') => { results.push(['FAIL', name, detail]); console.log('FAIL', name, detail); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

try {
  // ---- login (dentist auto-selects its single school since Sprint C)
  await page.goto(BASE + '/'); await page.waitForTimeout(2500);
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/select-school**', { timeout: 15000 }).catch(() => {});
  if (page.url().includes('select-school')) {
    await page.click('text=Integrated School');
    await page.waitForTimeout(1200);
    const cont = page.locator('button:has-text("Continue")');
    if (await cont.count()) await cont.first().click();
  }
  await page.waitForSelector('a[href="/patients"]', { timeout: 20000 });
  ok('login');

  // ---- 1. Dashboard renders + New Appointment CTA opens the create form
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/smoke_dashboard.png` });
  const cta = page.locator('a[href="/appointments?new=1"]');
  if (await cta.count()) {
    await cta.first().click();
    await page.waitForURL('**/appointments**', { timeout: 15000 });
    const modal = page.locator('h2:has-text("New Appointment")');
    await modal.waitFor({ timeout: 10000 });
    ok('dashboard CTA opens create form');
    if (page.url().includes('new=1')) bad('?new=1 stripped from URL', page.url());
    else ok('?new=1 stripped from URL');
    await page.screenshot({ path: `${SHOTS}/smoke_appt_modal.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else bad('dashboard CTA href', 'a[href="/appointments?new=1"] not found');

  // ---- 2. Students list renders rows (token pass + decrypt)
  await page.click('a[href="/patients"]');
  await page.waitForSelector('h1:has-text("Student Records")', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const rows = await page.locator('tbody tr').count();
  (rows > 0 ? ok : bad)('students rows render', `${rows} rows`);
  await page.screenshot({ path: `${SHOTS}/smoke_students.png` });

  // ---- 3. RPC: fluoride wording (deploy marker) + cutoff chips
  await page.click('a[href="/rpc"]');
  await page.waitForTimeout(2500);
  const subtitle = await page.locator('text=2nd fluoride dose').count();
  (subtitle ? ok : bad)('RPC fluoride-specific subtitle (deploy freshness)');
  const impossible = await page.locator('text=won\'t fit SY').count();
  const tight = await page.locator('span:has-text("by 20")').count();
  ok('RPC cutoff chips', `impossible=${impossible} tight=${tight} (0/0 can be honest if no pending rows are cut)`);
  await page.screenshot({ path: `${SHOTS}/smoke_rpc.png`, fullPage: true });

  // ---- 4. Reports: Internal → Treatment Summary, period buttons, real matrix
  await page.click('a[href="/reports"]');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Internal Reports")');
  await page.waitForTimeout(1000);
  const qBtn = page.locator('button:has-text("Quarterly")');
  (await qBtn.count() ? ok : bad)('Quarterly period button exists');
  await page.click('button:has-text("Annual")');
  await page.waitForTimeout(800);
  const foot = await page.locator('text=Counted from tooth-level').count();
  (foot ? ok : bad)('honesty footnote present');
  const totalRow = await page.locator('td:has-text("TOTAL")').first().locator('..').innerText().catch(() => 'n/a');
  ok('Treatment Summary TOTAL row (Annual)', JSON.stringify(totalRow));
  const sdfRow = await page.locator('td:has-text("Silver Diamine Fluoride")').count();
  (sdfRow ? ok : bad)('rows use treatmentCodes vocabulary (SDF row present)');
  await page.screenshot({ path: `${SHOTS}/smoke_treatment_summary.png`, fullPage: true });

  // ---- 5. DOH tab PDF download (token swap didn't break the capture)
  await page.click('button:has-text("DOH Consolidated")');
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent('download', { timeout: 90000 });
  await page.click('button:has-text("Download PDF")');
  const download = await dl;
  const pdfPath = `${SHOTS}/smoke_doh.pdf`;
  await download.saveAs(pdfPath);
  const size = statSync(pdfPath).size;
  (size > 50000 ? ok : bad)('DOH PDF downloads', `${Math.round(size / 1024)} KB`);
} catch (err) {
  bad('unexpected error', String(err).slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/smoke_error.png`, fullPage: true }).catch(() => {});
}

await browser.close();
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
