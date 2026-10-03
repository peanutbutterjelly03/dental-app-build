// Follow-up capture for the one figure the main run missed: the export
// dropdown. ExportMenu lives on Students/Appointments/RPC/Audit — not Reports
// (Reports has its own PDF/Excel buttons). Captures both.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BASE = 'https://dental-app-build.vercel.app';
const OUT = join(REPO, 'docs', 'figures');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const env = {};
for (const line of readFileSync(join(HERE, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const log = [];

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
for (let i = 0; i < 30 && page.url().includes('login'); i++) await page.waitForTimeout(500);
await page.waitForTimeout(2500);

// --- 4.4.5: ExportMenu dropdown, open, on the Students list ---
await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
try {
  const btn = page.getByRole('button', { name: /export/i }).first();
  await btn.click();
  await page.waitForTimeout(800);
  const menu = await page.locator('[role="menu"]').count();
  await page.addStyleTag({ content: 'aside { position: absolute !important; top: 0 !important; height: 100% !important; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'fig-4.4.5-export-menu.png'), fullPage: true });
  log.push(`fig-4.4.5-export-menu  — dropdown open: ${menu > 0 ? 'YES' : 'NO (menu not rendered)'}`);
} catch (e) { log.push(`fig-4.4.5-export-menu FAILED — ${e.message.split('\n')[0]}`); }

// --- 4.4.5b: Reports' own PDF / Excel download controls ---
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
try {
  const doh = page.getByRole('button', { name: /DOH|Consolidated/i }).first();
  if (await doh.count()) { await doh.click(); await page.waitForTimeout(2500); }
  await page.screenshot({ path: join(OUT, 'fig-4.4.5b-reports-download-controls.png'), fullPage: true });
  log.push('fig-4.4.5b-reports-download-controls  — captured');
} catch (e) { log.push(`fig-4.4.5b FAILED — ${e.message.split('\n')[0]}`); }

await browser.close();
console.log('\n' + log.join('\n'));
