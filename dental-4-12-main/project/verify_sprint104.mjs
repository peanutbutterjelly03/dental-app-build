// Sprint 104 — do the report screens refresh when the tab is refocused?
//
// Drives a real browser: open a report, count API calls, blur/refocus the tab,
// and assert a fresh fetch happened. Then assert the 30s throttle holds, and
// that a form screen was NOT given the behaviour (it would clobber edits).
//
//   node verify_sprint104.mjs
//   BASE_URL=http://localhost:5173 node verify_sprint104.mjs
import fs from 'node:fs';
import { chromium } from 'playwright';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const results = [];
const check = (name, pass, detail) => results.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail });

const browser = await chromium.launch();
const page = await browser.newPage();

let apiCalls = 0;
page.on('request', (r) => { if (r.url().includes('/api/') && r.method() === 'GET') apiCalls++; });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

// ⚠ SINCE SPRINT 100 THE DENTIST HOLDS ALL THREE SCHOOLS, so login lands on
// /select-school instead of going straight through — with one school it used to
// auto-select. Skipping this step silently lands every later assertion on the
// school picker, where nothing fetches and every count is 0. That is exactly
// how the first run of this file "failed": it was measuring an empty screen.
if (page.url().includes('/select-school')) {
  await page.click('main button, [role="main"] button, button:has-text("School")').catch(() => {});
  await page.waitForTimeout(1500);
}
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
if (page.url().includes('/select-school')) {
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /School/i.test(x.textContent || ''));
    if (b) { b.click(); return b.textContent.trim().slice(0, 40); }
    return null;
  });
  console.log('picked school:', picked);
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
}
check('the reports screen actually loaded (not the school gate)',
  !page.url().includes('/select-school'), page.url().replace(BASE, ''));

// ⚠ THE THROTTLE CLOCK STARTS AT MOUNT, not at the first refocus — `lastRefresh`
// is initialised to Date.now() inside the effect. That is correct behaviour (the
// data was just fetched on mount, so a refresh five seconds later is waste), but
// it means a test that refocuses immediately measures the throttle, not the
// refresh. The first version of this file did exactly that and reported a
// failure that was entirely its own. Wait the window out.
console.log('waiting out the 30s throttle window before the first refocus...');
await page.waitForTimeout(31000);

// --- refocus must trigger a refetch
apiCalls = 0;
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(3000);
const onRefocus = apiCalls;
check('refocus refetches the report', onRefocus > 0, `${onRefocus} GET /api calls`);

// --- and the 30s throttle must suppress an immediate second one
apiCalls = 0;
await page.evaluate(() => {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(3000);
check('a second refocus inside 30s is throttled', apiCalls === 0, `${apiCalls} GET /api calls`);

// --- a form screen must NOT do this: refetching would overwrite unsaved edits
const rows = await page.evaluate(async () => (await (await fetch('/api/stats/student-rows')).json()));
await page.goto(`${BASE}/dental-chart/${rows[0].id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
apiCalls = 0;
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(3000);
check('a FORM screen is deliberately NOT refreshed', apiCalls === 0,
  `${apiCalls} GET /api calls — refetching here would overwrite unsaved edits`);

console.table(results);
await browser.close();
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
