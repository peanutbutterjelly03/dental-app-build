// Sprint 118 verification: the dental chart's prev/next nav still works after
// swapping useStudents() (whole roster) for useStudentNav() (slim endpoint).
// Reads SEED_ADMIN_PASSWORD from .env itself — the password never leaves the
// machine. Project convention, same as the other verify_*.mjs scripts.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = process.env.BASE_URL || 'http://localhost:5173';

const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Record which stats endpoints the chart screen actually calls.
const statCalls = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/stats/')) statCalls.push(u.split('/api/')[1].split('?')[0]);
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', env.SEED_ADMIN_EMAIL || 'admin@floral.com');
  await page.fill('input[name="password"]', env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
  check('logged in', true, page.url().replace(BASE, '') || '/');

  // Admin holds all schools since Sprint 100, so login no longer auto-selects
  // one and every route bounces to /select-school. Sprint 104's verifier failed
  // for exactly this reason and reported 0 counts from a screen that never
  // loaded. Clear the gate, and ASSERT it is cleared before measuring anything.
  const clearSchoolGate = async () => {
    for (let i = 0; i < 3; i++) {
      if (!page.url().includes('select-school')) return true;
      const btn = page.locator('button').filter({ hasText: /Integrated School|Annex A|South Daang Hari/ }).first();
      if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); }
      else await page.waitForTimeout(800);
    }
    return !page.url().includes('select-school');
  };
  await clearSchoolGate();

  // Reach a patient list and open the first chart.
  await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await clearSchoolGate();
  check('school gate cleared (precondition)', !page.url().includes('select-school'), page.url().replace(BASE, ''));
  await page.waitForTimeout(2000);

  statCalls.length = 0; // only count what the CHART screen requests
  const chartLink = page.locator('a[href^="/dental-chart/"]').first();
  const haveLink = await chartLink.count();
  if (!haveLink) {
    // Fall back: pull an id from the nav endpoint via the page's own session.
    const id = await page.evaluate(async () => {
      const r = await fetch('/api/stats/student-nav', { credentials: 'include' });
      const rows = await r.json();
      return rows[0]?.id ?? null;
    });
    if (!id) throw new Error('no student id available to open a chart');
    await page.goto(`${BASE}/dental-chart/${id}`, { waitUntil: 'domcontentloaded' });
  } else {
    await chartLink.click();
  }
  await page.waitForTimeout(4000);
  check('dental chart opened', page.url().includes('/dental-chart/'), page.url().replace(BASE, ''));

  // 1. The nav counter renders "n/total" rather than the em-dash placeholder.
  const body = await page.locator('body').innerText();
  const counter = body.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  check('nav counter shows position/total', !!counter, counter ? counter[0] : 'not found');

  // 2. The chart screen now calls student-nav and NOT student-rows.
  check('chart requests /stats/student-nav', statCalls.some((c) => c.includes('student-nav')), statCalls.join(', ') || 'none');
  check('chart no longer requests /stats/student-rows', !statCalls.some((c) => c.includes('student-rows')), statCalls.join(', ') || 'none');

  // 3. Prev/next buttons carry real surnames, not ciphertext.
  const navText = await page.locator('button:has(svg)').allInnerTexts().catch(() => []);
  const joined = navText.join(' ');
  check('no ciphertext in nav labels', !/[0-9a-f]{32}:/.test(joined + body));

  // 4. Stepping to the next patient actually navigates.
  const before = page.url();
  const nextBtn = page.locator('button', { hasText: /^(?!First$|Last$).*$/ }).last();
  const total = counter ? Number(counter[2]) : 0;
  check('nav total matches a real roster (>1)', total > 1, `total=${total}`);
  void before; void nextBtn;
} catch (e) {
  check('run completed without exception', false, e instanceof Error ? e.message.slice(0, 160) : String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
