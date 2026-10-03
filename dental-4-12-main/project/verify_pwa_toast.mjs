// PWA update toast verification against the local production build
// (vite preview :4173 + dev:server :4000). Flow:
//  A. load app, login, wait until the v1 service worker controls the page
//  B. inject a visible marker into Root.tsx, rebuild (v2)
//  C. reload once -> toast must appear (v2 SW waiting, NOT auto-applied)
//  D. click Refresh -> page reloads under v2 -> marker text visible
//  E. offline queue re-test: go offline, add throwaway student, banner +
//     pending badge, back online -> syncs for real
//  F. cleanup: archive throwaway via admin API; restore Root.tsx; rebuild clean
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const env = Object.fromEntries(readFileSync('./.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const ROOT_TSX = './src/app/components/Root.tsx';
const TAG = 'Dental Health Record Management System';
const MARKER = TAG + ' · v2-test';
const rootOriginal = readFileSync(ROOT_TSX, 'utf8');

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
let failed = false;
const check = (label, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label); if (!ok) failed = true; };

try {
  // A. load + login + SW v1 controls page
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'dentist@floral.com');
  await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 45000 });
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller != null, { timeout: 30000 });
  check('A: logged in, v1 service worker controls the page', true);

  // B. marker + rebuild v2
  writeFileSync(ROOT_TSX, rootOriginal.replace(TAG + '</div>', MARKER + '</div>'));
  execSync('npm run build', { stdio: 'pipe' });
  console.log('   (v2 build with marker done)');

  // C. one reload -> new SW detected and WAITS -> toast appears
  await page.reload();
  await page.waitForSelector('a[href="/patients"]', { timeout: 45000 });
  const toast = page.locator('text=A new version of FLORAL is available.');
  await toast.waitFor({ timeout: 60000 });
  check('C: update toast appeared after reload', true);
  const bodyPreRefresh = await page.locator('body').innerText();
  check('C2: old version still running until Refresh (no v2-test yet)', !bodyPreRefresh.includes('v2-test'));

  // D. click Refresh -> v2 takes over
  await page.click('button:has-text("Refresh")');
  await page.waitForSelector('text=v2-test', { timeout: 60000 });
  check('D: Refresh applied the new version (v2-test marker visible)', true);

  // E. offline queue re-test
  await page.click('a[href="/patients"]');
  await page.waitForSelector('tbody tr', { timeout: 45000 });
  await context.setOffline(true);
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Add Student")');
  await page.waitForSelector('text=Add New Student', { timeout: 10000 });
  const modal = page.locator('div.fixed.inset-0', { hasText: 'Add New Student' });
  const textInputs = modal.locator('input[type="text"]');
  await textInputs.nth(0).fill('OfflineQueue');          // Last Name
  await textInputs.nth(1).fill('ZZTest');                // First Name
  await modal.locator('input[type="date"]').fill('2018-01-15');
  const selects = modal.locator('select');
  await selects.nth(0).selectOption({ label: 'Male' });  // Gender
  const schoolVal = await selects.nth(1).evaluate((el) => [...el.options].find(o => o.text.includes('Integrated'))?.value);
  await selects.nth(1).selectOption(schoolVal);          // School
  await selects.nth(2).selectOption({ label: 'Kinder' }); // Grade
  await textInputs.nth(3).fill('ZZTestSection');         // Section
  await textInputs.nth(5).fill('ZZ Guardian');           // Guardian Name
  await textInputs.nth(8).fill('Test Address, Taguig');  // Address
  await modal.locator('button:has-text("Add Student")').click();
  await page.waitForTimeout(2500);
  const offlineBody = await page.locator('body').innerText();
  check('E1: offline banner shows pending write', /offline/i.test(offlineBody) && /pending/i.test(offlineBody));
  check('E2: optimistic row with Pending sync badge', /ZZTest/.test(offlineBody) && /Pending sync/i.test(offlineBody));

  await context.setOffline(false);
  // wait for the queue to drain: banner gone + row no longer pending
  await page.waitForFunction(() => !document.body.innerText.match(/Pending sync/i), { timeout: 45000 });
  await page.waitForTimeout(2000);
  const syncedBody = await page.locator('body').innerText();
  check('E3: back online — queue drained, row synced for real', /ZZTest/.test(syncedBody) && !/Pending sync/i.test(syncedBody));
} finally {
  // F. cleanup — always restore source + rebuild clean dist
  writeFileSync(ROOT_TSX, rootOriginal);
  execSync('npm run build', { stdio: 'pipe' });
  console.log('   (Root.tsx restored, clean rebuild done)');
  await browser.close();
}

// archive the throwaway student via admin API (soft delete, audited)
const login = await fetch('http://localhost:4000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }),
});
if (login.ok) {
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const students = await (await fetch('http://localhost:4000/api/students', { headers: { Cookie: cookie } })).json();
  const target = students.find(s => s.full_name === 'ZZTest OfflineQueue');
  if (target) {
    const arch = await fetch(`http://localhost:4000/api/students/${target._id}/archive`, { method: 'PATCH', headers: { Cookie: cookie } });
    console.log('cleanup: throwaway student archived:', arch.status === 200 ? 'OK' : 'status ' + arch.status);
  } else {
    console.log('cleanup: throwaway student not found (may not have synced — check manually)');
  }
} else {
  console.log('cleanup: admin login failed', login.status, '— archive ZZTest OfflineQueue manually');
}
console.log(failed ? 'RESULT: FAILURES PRESENT' : 'RESULT: ALL PASS');
