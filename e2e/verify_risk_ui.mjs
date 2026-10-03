// End-to-end verification of the Sprint 21f Risk Classification UI.
// Logs in as the dentist, generates an assessment for a student with an RPC
// visit, validates + saves it, and screenshots each stage.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR;
const DENTIST_PASSWORD = process.env.DENTIST_PASSWORD;
if (!DENTIST_PASSWORD) {
  console.error('Set DENTIST_PASSWORD (never hardcode real credentials here).');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

// login
await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/select-school**', { timeout: 15000 }).catch(() => {});
console.log('logged in, url:', page.url());
// school selection step
if (page.url().includes('select-school')) {
  // the card shows the abbreviated school name ("BT Integrated School")
  await page.click('text=Integrated School');
  await page.waitForTimeout(1500);
  const cont = page.locator('button:has-text("Continue")');
  if (await cont.count()) await cont.first().click();
  await page.waitForTimeout(1500);
  console.log('school selected, url:', page.url());
}

// risk classification page — navigate via the sidebar link, not page.goto():
// a full reload loses the in-memory selected-school state and bounces back
// to /select-school (known app quirk)
await page.click('a[href="/ai-analytics"]');
await page.waitForURL('**/ai-analytics', { timeout: 15000 });
await page.waitForSelector('text=synthetic placeholder data', { timeout: 15000 });
console.log('page loaded, synthetic-data banner visible');

// pick a student known to have RPC visits (seeded: Aldrin Villanueva = complete)
await page.fill('input[placeholder="Search students…"]', 'Aldrin');
await page.waitForTimeout(500);
await page.click('button:has-text("Aldrin")');
await page.waitForSelector('text=Generate Risk Assessment');
await page.screenshot({ path: SHOTS + '/risk-1-selected.png', fullPage: true });

// generate
await page.click('button:has-text("Generate Risk Assessment")');
await page.waitForSelector('text=Model Assessment', { timeout: 30000 });
const badge = await page.textContent('span:has-text("RISK")');
console.log('prediction badge:', badge?.trim());
await page.screenshot({ path: SHOTS + '/risk-2-prediction.png', fullPage: true });

// validate + save
const saveBtn = page.locator('button:has-text("Save Validated Assessment")');
console.log('save disabled before notes:', await saveBtn.isDisabled());
await page.fill('textarea', 'Reviewed odontogram and habits; concur with model assessment.');
console.log('save disabled after notes:', await saveBtn.isDisabled());
await saveBtn.click();
await page.waitForSelector('text=Validated assessment saved', { timeout: 15000 });
console.log('validated assessment saved');
await page.waitForSelector('text=Dentist-validated', { timeout: 15000 });
console.log('history shows Dentist-validated entry');
await page.screenshot({ path: SHOTS + '/risk-3-saved.png', fullPage: true });

await browser.close();
console.log('UI VERIFICATION PASSED');
