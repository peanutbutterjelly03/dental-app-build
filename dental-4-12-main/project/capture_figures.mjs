// Chapter 4 figure capture — drives the deployed app and saves one PNG per
// figure slot in docs/chapter4-5-draft.md. Reads credentials from the sibling
// .env; never prints them.
//
// Run from this directory: node capture_figures.mjs
// Output: <repo>/docs/figures/*.png

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));       // .../dental-4-12-main/project
const REPO = resolve(HERE, '..', '..');                      // repo root
// Defaults to the DEPLOYED site — the figures should show what a panelist
// would see. Override for a local capture:
//   BASE_URL=http://localhost:5173 node capture_figures.mjs
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';
const OUT = join(REPO, 'docs', 'figures');

// --- env ---------------------------------------------------------------
const env = {};
// ⚠ Split on /\r?\n/, not '\n'. With the repo's CRLF checkout every line keeps
// a trailing \r, and \r is a LINE TERMINATOR in a JS regex — so the `(.*)$`
// below never matches and this silently yields an EMPTY env, surfacing much
// later as `page.fill: expected string, got undefined`. Identical bug to the
// one repaired in verify_sprint33.mjs on 2026-09-03.
for (const line of readFileSync(join(HERE, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ACCOUNTS = {
  dentist:     { email: 'dentist@floral.com',     pw: env.SEED_DENTIST_PASSWORD },
  aide:        { email: 'aide@floral.com',        pw: env.SEED_AIDE_PASSWORD },
  schooladmin: { email: 'schooladmin@floral.com', pw: env.SEED_SCHOOLADMIN_PASSWORD },
  bho:         { email: 'bho@floral.com',         pw: env.SEED_BHO_PASSWORD },
  admin:       { email: env.SEED_ADMIN_EMAIL,     pw: env.SEED_ADMIN_PASSWORD },
};

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
const ok   = (n, m = '') => { results.push(`PASS  ${n}${m ? '  — ' + m : ''}`); console.log(`  ok   ${n}`); };
const fail = (n, e)       => { results.push(`FAIL  ${n}  — ${e}`);              console.log(`  FAIL ${n}: ${e}`); };

// On pages taller than the viewport, Playwright's fullPage capture leaves
// position:fixed elements floating at their viewport offset — the sidebar ends
// up stranded mid-page. Pinning it to absolute/full-height for the capture
// makes it span the whole image the way a reader expects.
const PIN_FIXED = `
  aside { position: absolute !important; top: 0 !important; height: 100% !important; }
`;

/** `fullPage: false` captures the VIEWPORT only.
 *
 *  ⚠ Needed for figures whose subject sits at the TOP of a very long page. The
 *  export menu on the audit trail came out 2880x25592 (5 MB) as a full-page
 *  shot — every one of the 90-day window's log rows, with the dropdown a
 *  sliver at the top. A figure nobody can read is not a captured figure. */
async function shot(page, name, note = '', { fullPage = true } = {}) {
  try {
    await page.waitForTimeout(1800); // let charts/skeletons settle
    // ⚠ Scroll to the top FIRST. Clicking a row part-way down a list leaves the
    // page scrolled, and with the sidebar pinned to top:0 for the capture the
    // content then rides up under it — fig-4.3.5 came out with its "Risk
    // Classification" heading sliced in half by the sidebar.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const style = await page.addStyleTag({ content: PIN_FIXED });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
    await style.evaluate((el) => el.remove()).catch(() => {});
    ok(name, note);
  } catch (e) { fail(name, e.message.split('\n')[0]); }
}

async function login(page, who) {
  const { email, pw } = ACCOUNTS[who];
  if (!pw) throw new Error(`no password in .env for ${who}`);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
  // poll for the redirect rather than guessing a fixed delay
  for (let i = 0; i < 30 && page.url().includes('login'); i++) await page.waitForTimeout(500);
  if (page.url().includes('select-school')) {
    const cards = page.locator('.grid button');
    if (await cards.count()) { await cards.first().click(); await page.waitForTimeout(2500); }
  }
  if (page.url().includes('login')) throw new Error('still on /login after 15s — check credentials');
  await page.waitForTimeout(2000);
}

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (page.url().includes('select-school')) {
    const cards = page.locator('.grid button');
    if (await cards.count()) { await cards.first().click(); await page.waitForTimeout(2000); }
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  }
}

// --- run ---------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

try {
  // ===== DENTIST =====
  console.log('\n[dentist]');
  await login(page, 'dentist');

  await go(page, '/');            await shot(page, 'fig-4.4.1-dashboard-dentist');
  await go(page, '/patients');    await shot(page, 'fig-4.1.1-student-list');

  // NOTE: medical history, dietary/social habits and oral health conditions all
  // live on ONE tab ("History & Oral") — they are not separate screens, so the
  // draft's 4.1.2 and 4.1.3 collapse into a single figure. The remaining tabs
  // (Consent, Treatment History, DMFT History) are real features worth figures.
  try {
    const row = page.locator('tbody tr').first();
    if (await row.count()) {
      await row.click();
      // Wait for the tab strip itself, not a fixed timeout. On 2026-08-11 all
      // three tab figures failed with `no "Consent" tab` against production:
      // the tabs exist and are plain buttons with exactly these labels
      // (verified in the DOM), the detail view was simply still loading when
      // the 2.5s timer expired. A count() check on a not-yet-rendered element
      // returns 0 and reports a missing feature rather than a slow one.
      await page.getByRole('button', { name: /^History & Oral$/i }).first()
        .waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForTimeout(800);
      await shot(page, 'fig-4.1.2-iptr-history-and-oral');
      for (const [label, name] of [
        ['Consent',           'fig-4.1.3a-consent-tab'],
        ['Treatment History', 'fig-4.1.3b-treatment-history-tab'],
        ['DMFT History',      'fig-4.1.3c-dmft-history-tab'],
      ]) {
        const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
        try {
          await tab.waitFor({ state: 'visible', timeout: 15000 });
          await tab.click(); await page.waitForTimeout(1800); await shot(page, name);
        } catch { fail(name, `no "${label}" tab (waited 15s)`); }
      }
    } else fail('fig-4.1.2-iptr-history-and-oral', 'no student rows on /patients');
  } catch (e) { fail('fig-4.1.2/4.1.3 student detail', e.message.split('\n')[0]); }

  await go(page, '/dental-charts'); await shot(page, 'fig-4.1.4a-dental-chart-list');
  try {
    const row = page.locator('tbody tr').first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(3000); await shot(page, 'fig-4.1.4-dental-chart'); }
    else fail('fig-4.1.4-dental-chart', 'no chart rows');
  } catch (e) { fail('fig-4.1.4-dental-chart', e.message.split('\n')[0]); }

  await go(page, '/appointments');       await shot(page, 'fig-4.2.1-appointments');
  await go(page, '/treatment-records');  await shot(page, 'fig-4.2.2-treatment-records');
  await go(page, '/rpc');                await shot(page, 'fig-4.2.3-rpc-tracking');
  await go(page, '/ai-analytics');       await shot(page, 'fig-4.3.4-risk-classification', 'ML service may be cold');

  // fig-4.3.5 — the dentist-validation panel (ADDED 2026-09-03; was the only
  // figure captured by hand, and so the only one nobody could reproduce).
  //
  // ⚠ It needs a STUDENT SELECTED: the panel does not exist on the list view.
  // ⚠ The ML service sleeps on Render's free tier — first request 30-60s and
  // it may 503 once — so this waits generously and reports rather than failing
  // the whole run. CLAUDE.md's premise is that the dentist validates every
  // recommendation, which makes this the figure a panelist is most likely to
  // ask about; it is worth the wait.
  try {
    const firstStudent = page.locator('button').filter({ hasText: /Bagong Tanyag|Daang Hari|Annex/ }).first();
    if (!(await firstStudent.count())) throw new Error('no student rows on /ai-analytics');
    await firstStudent.click();
    await page.waitForTimeout(3000);

    // ⚠ SELECTING A STUDENT IS NOT ENOUGH. The validation panel only exists
    // once an assessment has been generated — "Generate Risk Assessment" calls
    // the ML service first. The earlier version waited 60s for a
    // "Validate & Save" button that could never appear, and timed out.
    const generate = page.getByRole('button', { name: /Generate Risk Assessment/i }).first();
    const validate = page.getByRole('button', { name: /Validate & Save/i }).first();
    if (await generate.count()) {
      await generate.click();
      // ⚠ The ML service sleeps on Render's free tier: first request 30-60s,
      // and it MAY 503 once (HANDOFF, current status). One retry is expected
      // behaviour here, not a workaround for a flaky test.
      try {
        await validate.waitFor({ state: 'visible', timeout: 90000 });
      } catch {
        await generate.click();
        await validate.waitFor({ state: 'visible', timeout: 90000 });
      }
    } else {
      await validate.waitFor({ state: 'visible', timeout: 30000 });
    }
    // ⚠ CAPTURE ONLY — never click Validate & Save. That writes a validated
    // RISK_STRATIFICATION and is recorded in the audit trail as clinical
    // sign-off by a dentist who never saw it.
    await shot(page, 'fig-4.3.5-dentist-validation');
  } catch (e) { fail('fig-4.3.5-dentist-validation', e.message.split('\n')[0]); }
  await go(page, '/reports');            await shot(page, 'fig-4.4.4-reports');

  // ⚠ ADDED 2026-09-03. The line above captures the Reports screen at its
  // DEFAULT tab and DEFAULT school year, so the Oral Health Program Reporting
  // Form — rebuilt against the filed DOH return in Sprint 89, wired to real
  // numbers in 90 and populated in 98 — appeared in NO figure at all.
  //
  // ⚠ The year picker must be moved to 2025-2026 first: it defaults to the
  // CURRENT school year, where the demo roster has almost nothing, so a capture
  // of the default view would show a form full of zeros and misrepresent the
  // build.
  try {
    const yearSelect = page.locator('select').filter({ hasText: 'All years to date' }).first();
    await yearSelect.selectOption('2025-2026');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Program Report/i }).first().click();
    await page.waitForTimeout(3500);
    await shot(page, 'fig-4.4.4b-program-report');
  } catch (e) { fail('fig-4.4.4b-program-report', e.message.split('\n')[0]); }

  // fig-4.4.5b — the per-form download controls (ADDED 2026-09-03).
  //
  // ⚠ THE MOST MISLEADING FIGURE IN THE SET while it was stale: Sprint 85
  // changed exactly these controls, and the FORMATS ARE A DECISION, not an
  // oversight — the Target Client List offers Excel ONLY (66 columns; also the
  // format the City Health Office requires), the Program Report offers PDF and
  // Excel, the IPTR is PDF only. The figure has to show a form where BOTH
  // buttons exist, or it argues the opposite of what the design says.
  try {
    await page.getByRole('button', { name: /Program Report/i }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /^PDF$/i }).first().waitFor({ state: 'visible', timeout: 15000 });
    await shot(page, 'fig-4.4.5b-reports-download-controls');
  } catch (e) { fail('fig-4.4.5b-reports-download-controls', e.message.split('\n')[0]); }

  // fig-4.4.5 (the ExportMenu dropdown) is NOT captured here. It used to look
  // for an Export button on /reports, which has never had one -- Reports offers
  // "Download PDF" and "Download Excel" directly, while ExportMenu lives on
  // Students / Appointments / RPC / Audit. The block reported a missing feature
  // on every run. `capture_export.mjs` owns 4.4.5 (from /patients) and 4.4.5b
  // (Reports' own download controls); run it after this script.

  // ===== SYSTEM ADMIN =====
  console.log('\n[system_admin]');
  await ctx.clearCookies();
  await login(page, 'admin');
  await go(page, '/accounts'); await shot(page, 'fig-4.2.5-account-management');
  await go(page, '/audit');    await shot(page, 'fig-4.2.4-audit-trail');

  // fig-4.4.5 — the Export menu, open (ADDED 2026-09-03).
  //
  // ⚠ CAPTURED ON THE AUDIT TRAIL, AND THAT IS THE POINT. `ExportMenu` used to
  // appear on Students, RPC and Appointments; Sprint 52 REMOVED it from all of
  // them, because a raw list of minors leaving the system is the exact PII leak
  // the rule forbids. The audit trail is the ONLY screen that still carries it,
  // so this figure now documents a deliberate restriction rather than a generic
  // control — capturing it anywhere else would misrepresent the build.
  try {
    const exportBtn = page.getByRole('button', { name: /^Export/i }).first();
    await exportBtn.waitFor({ state: 'visible', timeout: 15000 });
    await exportBtn.click();
    await page.waitForTimeout(800);
    // Viewport only: the menu is at the top of a page 25,000px long.
    await shot(page, 'fig-4.4.5-export-menu', '', { fullPage: false });
  } catch (e) { fail('fig-4.4.5-export-menu', e.message.split('\n')[0]); }

  // ===== SCHOOL ADMIN =====
  console.log('\n[school_admin]');
  await ctx.clearCookies();
  await login(page, 'schooladmin');
  await go(page, '/'); await shot(page, 'fig-4.4.2a-dashboard-school-admin');

  // ===== BHO =====
  console.log('\n[bho_staff]');
  await ctx.clearCookies();
  await login(page, 'bho');
  await go(page, '/'); await shot(page, 'fig-4.4.2b-dashboard-bho');

} catch (e) {
  fail('RUN ABORTED', e.message.split('\n')[0]);
} finally {
  await browser.close();
  const pass = results.filter(r => r.startsWith('PASS')).length;
  console.log(`\n===== ${pass}/${results.length} captured -> docs/figures/ =====`);
  results.forEach(r => console.log(r));
}
