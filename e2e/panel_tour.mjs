// Read-only production tour for the persona review panel. Navigates every
// main screen as the dentist and screenshots each. No writes.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('./.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const BASE = 'https://dental-app-build.vercel.app';
const SHOTS = process.env.SHOTS_DIR;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const t0 = Date.now();
await page.goto(BASE + '/');
await page.waitForSelector('input[type="email"]', { timeout: 20000 });
console.log('login page loaded in', Date.now() - t0, 'ms');
await page.screenshot({ path: SHOTS + '/p0-login.png' });

await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
const t1 = Date.now();
await page.click('button[type="submit"]');
await page.waitForURL('**/select-school**', { timeout: 20000 }).catch(()=>{});
console.log('login roundtrip', Date.now() - t1, 'ms');
await page.screenshot({ path: SHOTS + '/p1-school-select.png' });
if (page.url().includes('select-school')) {
  await page.click('text=Integrated School');
  await page.waitForTimeout(1000);
  const cont = page.locator('button:has-text("Continue")');
  if (await cont.count()) await cont.first().click();
  await page.waitForTimeout(1500);
}

const tabs = [
  ['/', 'p2-dashboard'],
  ['/patients', 'p3-patients'],
  ['/dental-charts', 'p4-dental-charts'],
  ['/appointments', 'p5-appointments'],
  ['/rpc', 'p6-rpc'],
  ['/ai-analytics', 'p7-risk'],
  ['/reports', 'p8-reports'],
];
for (const [path, name] of tabs) {
  const t = Date.now();
  await page.click(`a[href="${path}"]`).catch(() => page.goto(BASE + path));
  await page.waitForTimeout(3500);
  console.log(name, 'settled in ~', Date.now() - t, 'ms, url:', page.url());
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

// open one dental chart for the dentist seat
await page.click('a[href="/patients"]');
await page.waitForTimeout(2000);
await page.locator('tbody tr').first().click();
await page.waitForTimeout(3000);
console.log('chart url:', page.url());
await page.screenshot({ path: SHOTS + '/p9-dental-chart-detail.png', fullPage: true });

console.log('CONSOLE ERRORS DURING TOUR:', errors.length ? errors.join('\n') : 'none');
await browser.close();
