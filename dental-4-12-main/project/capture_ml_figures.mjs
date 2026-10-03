// Re-capture the two predictive-analytics figures. The first run caught the
// Render ML service asleep (amber "service isn't responding" banner + empty
// panel) — unusable as a manuscript figure. This wakes the service, selects a
// student, generates a real assessment, and captures both 4.3.4 and 4.3.5.

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

const log = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
for (let i = 0; i < 30 && page.url().includes('login'); i++) await page.waitForTimeout(500);
await page.waitForTimeout(2500);

await page.goto(`${BASE}/ai-analytics`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// wait out the cold-start banner if it's up
for (let i = 0; i < 24; i++) {
  const warn = await page.getByText(/prediction service isn't responding/i).count();
  if (!warn) break;
  log.push(`  waiting for ML service… (${(i + 1) * 5}s)`);
  await page.waitForTimeout(5000);
}
const stillCold = await page.getByText(/prediction service isn't responding/i).count();
log.push(stillCold ? 'WARNING: ML service still cold after 120s' : 'ML service responding');

// pick a student with an existing assessment so the panel has content
try {
  const row = page.locator('button, [role="button"]').filter({ hasText: /Villanueva|Santos|Morales|Lopez/ }).first();
  if (await row.count()) { await row.click(); }
  else { await page.locator('.divide-y > *').first().click(); }
  await page.waitForTimeout(3000);
  log.push('student selected');
} catch (e) { log.push(`student select FAILED — ${e.message.split('\n')[0]}`); }

// generate the assessment
try {
  const gen = page.getByRole('button', { name: /Generate Risk Assessment/i }).first();
  if (await gen.count()) {
    await gen.click();
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(2500);
      if (await page.getByText(/Model Assessment/i).count()) break;
    }
    log.push('assessment generated');
  } else log.push('no Generate button (student may already have a cached assessment)');
} catch (e) { log.push(`generate FAILED — ${e.message.split('\n')[0]}`); }

await page.waitForTimeout(2000);
await page.addStyleTag({ content: 'aside { position: absolute !important; top: 0 !important; height: 100% !important; }' });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'fig-4.3.4-risk-classification.png'), fullPage: true });
log.push('fig-4.3.4-risk-classification  — recaptured');

// the validation form (pre-filled editable fields + Validate & Save)
try {
  const save = page.getByRole('button', { name: /Validate\s*&\s*Save/i }).first();
  if (await save.count()) {
    await save.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, 'fig-4.3.5-dentist-validation.png'), fullPage: true });
    log.push('fig-4.3.5-dentist-validation  — captured (Validate & Save present)');
  } else {
    await page.screenshot({ path: join(OUT, 'fig-4.3.5-dentist-validation.png'), fullPage: true });
    log.push('fig-4.3.5-dentist-validation  — captured BUT no "Validate & Save" button found; verify by eye');
  }
} catch (e) { log.push(`fig-4.3.5 FAILED — ${e.message.split('\n')[0]}`); }

await browser.close();
console.log('\n' + log.join('\n'));
