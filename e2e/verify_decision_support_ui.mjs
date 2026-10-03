// E2E verification: Sprint 21g (overview tiles, priority queue, bulk assess,
// per-student validation) + PatientList toggleable queue / tick-box bulk queue.
// Updated for Sprint 31 (dentist-validation UX): model output pre-fills
// editable fields marked "AI-suggested", one "Validate & Save" button, audit
// trail records accepted-vs-changed (checked via admin API at the end).
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR ?? '.';
const env = Object.fromEntries(
  readFileSync(process.env.ENV_FILE, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const PASSWORD = env.SEED_DENTIST_PASSWORD;
if (!PASSWORD) { console.error('no dentist password in env file'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

// ---- login + school select
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
  await page.waitForTimeout(1200);
}
console.log('STEP login ok, url:', page.url());

// ---- Risk Classification (21g)
await page.click('a[href="/ai-analytics"]');
await page.waitForURL('**/ai-analytics', { timeout: 15000 });
await page.waitForSelector('text=Unassessed', { timeout: 20000 });

// overview tiles
for (const label of ['High Risk', 'Medium Risk', 'Low Risk', 'Unassessed', 'Worsening', 'Improving']) {
  const tile = page.locator(`div.bg-white:has(span:text-is("${label}"))`).first();
  const val = await tile.locator('p').textContent();
  console.log(`TILE ${label}: ${val}`);
}

// priority sort default + toggle
const sortBtn = page.locator('button:has-text("order")').first();
console.log('SORT default label:', (await sortBtn.textContent()).trim());
const firstNamesPriority = await page.locator('.divide-y button .text-sm.font-medium').allTextContents();
console.log('LIST priority order (first 5):', firstNamesPriority.slice(0, 5).join(' | '));
await sortBtn.click();
console.log('SORT after toggle:', (await sortBtn.textContent()).trim());
const firstNamesName = await page.locator('.divide-y button .text-sm.font-medium').allTextContents();
console.log('LIST name order (first 5):', firstNamesName.slice(0, 5).join(' | '));
await sortBtn.click(); // back to priority

// bulk assess: check disabled state with 0 selected (probe)
const bulkBtn = page.locator('button:has-text("Assess Selected")');
console.log('PROBE bulk button disabled with 0 selected:', await bulkBtn.isDisabled());

// tick first two students that have checkboxes
const boxes = page.locator('.divide-y input[type="checkbox"]');
await boxes.nth(0).check();
await boxes.nth(1).check();
console.log('BULK button label after 2 ticks:', (await bulkBtn.textContent()).trim());
await page.screenshot({ path: SHOTS + '/21g-1-selected.png', fullPage: true });
await bulkBtn.click();
// wait until progress finishes (label returns to Assess Selected (0))
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Assess Selected'));
  return b && b.textContent.includes('(0)');
}, { timeout: 180000 });
const reviewBadges = await page.locator('span:has-text("review")').count();
console.log('BULK done, review badges:', reviewBadges);
await page.screenshot({ path: SHOTS + '/21g-2-bulk-done.png', fullPage: true });

// open a bulk-assessed student -> prediction card appears WITHOUT Generate
const badgeRow = page.locator('.divide-y > div:has(span:has-text("review"))').first();
const openedName = await badgeRow.locator('.text-sm.font-medium').textContent();
await badgeRow.locator('button').last().click();
await page.waitForSelector('text=Model Assessment', { timeout: 10000 });
console.log('REVIEW opened', openedName.trim(), '- Model Assessment card shown from cached bulk result (no Generate click)');
await page.screenshot({ path: SHOTS + '/21g-3-review.png', fullPage: true });

// validate + save (if student has an RPC visit — otherwise report).
// Sprint 31 UI: editable pre-filled fields with AI-suggested chips + one
// Validate & Save button.
const saveBtn = page.locator('button:has-text("Validate & Save")');
if (await saveBtn.count()) {
  const chips = await page.locator('span:text-is("AI-suggested")').count();
  console.log('AI-SUGGESTED chips on pre-filled fields (expect 2):', chips);
  // probe the edited-state chip: change the risk level away and back
  const levelSelect = page.locator('select[aria-label="Validated risk level"]');
  const suggested = await levelSelect.inputValue();
  await levelSelect.selectOption(suggested === 'High' ? 'Low' : 'High');
  const editedChip = await page.locator('span:has-text("edited — model suggested")').count();
  console.log('PROBE edited chip after changing level:', editedChip === 1 ? 'shown' : 'MISSING');
  await page.screenshot({ path: SHOTS + '/21g-3b-edited-chip.png', fullPage: true });
  await levelSelect.selectOption(suggested); // accept as-is for the save
  await page.fill('textarea[aria-label="Clinical notes"]', 'Bulk-generated assessment reviewed; concur with model.');
  await saveBtn.click();
  await page.waitForSelector('text=Validated assessment saved', { timeout: 15000 });
  const badgesAfter = await page.locator('span:has-text("review")').count();
  console.log('VALIDATED saved; review badges now:', badgesAfter, '(was', reviewBadges + ')');
  await page.screenshot({ path: SHOTS + '/21g-4-validated.png', fullPage: true });

  // audit trail must record accepted-vs-changed (server-side comparison)
  const adminCtx = await browser.newContext();
  const login = await adminCtx.request.post(BASE + '/api/auth/login', {
    data: { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
  });
  if (login.ok()) {
    const audits = await (await adminCtx.request.get(BASE + '/api/audit-trails')).json();
    const latest = audits
      .filter((a) => a.affected_model === 'RiskStratification')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    console.log('AUDIT latest RiskStratification action:', latest?.action ?? 'NONE FOUND');
    console.log('AUDIT records accepted/changed:', /accepted AI suggestion|changed AI suggestion/.test(latest?.action ?? '') ? 'YES' : 'NO — REGRESSION');
  } else {
    console.log('AUDIT check skipped: admin login failed', login.status());
  }
  await adminCtx.close();
} else {
  console.log('NOTE: opened student has no RPC visit — validation panel shows guidance instead (expected path)');
}

// ---- PatientList: tick-box bulk queue + toggleable queue button
await page.click('a[href="/patients"]');
await page.waitForURL('**/patients', { timeout: 15000 });
await page.waitForTimeout(1000);
await page.waitForSelector('table', { timeout: 10000 });
const footer = await page.locator('text=/Showing \\d+ of \\d+ students/').textContent().catch(() => 'no footer');
console.log('PATIENTS footer:', footer);

// header select-all
await page.locator('thead input[type="checkbox"]').check();
const queueSelBtn = page.locator('button:has-text("Queue Selected")');
console.log('QUEUE-SELECTED label:', (await queueSelBtn.textContent()).trim());
await page.screenshot({ path: SHOTS + '/21g-5-ticked.png', fullPage: true });
await queueSelBtn.click();
await page.waitForTimeout(500);
const queuedCount = await page.locator('button:has-text("Queued ✓")').count();
console.log('QUEUED buttons after bulk queue:', queuedCount);

// probe: un-queue one (toggle off)
await page.locator('button:has-text("Queued ✓")').first().click();
await page.waitForTimeout(300);
const queuedAfter = await page.locator('button:has-text("Queued ✓")').count();
console.log('PROBE un-queue: queued count', queuedCount, '->', queuedAfter);
const stored = await page.evaluate(() => localStorage.getItem('queued-student-ids'));
console.log('localStorage queue:', stored);
await page.screenshot({ path: SHOTS + '/21g-6-queue-toggled.png', fullPage: true });

await browser.close();
console.log('21G VERIFICATION SCRIPT COMPLETE');
