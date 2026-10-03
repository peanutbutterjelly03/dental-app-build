// STRICT read-only production probes for the persona review panel.
// No writes: navigation, one wrong-password attempt, form-validation probes only.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('./.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const BASE = 'https://dental-app-build.vercel.app';
const SHOTS = process.env.SHOTS_DIR;
const browser = await chromium.launch();

// ---------- Probe A: cold-load timing + login error handling (desktop) ----------
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('desktop: ' + m.text()); });
page.on('pageerror', e => errors.push('desktop PAGEERROR: ' + e.message));

let t = Date.now();
await page.goto(BASE + '/');
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
console.log('A1 cold login-page paint:', Date.now() - t, 'ms');

// empty submit — does the browser/app tell the user anything?
await page.click('button[type="submit"]');
await page.waitForTimeout(800);
const emailValidation = await page.locator('input[type="email"]').evaluate(el => el.validationMessage);
console.log('A2 empty-submit native validation message:', JSON.stringify(emailValidation));

// ONE wrong-password attempt (rate limit is 10/15min — stay well under)
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', 'definitely-wrong-password');
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);
await page.screenshot({ path: SHOTS + '/q1-login-error.png' });
const bodyText = await page.locator('body').innerText();
const errLine = bodyText.split('\n').find(l => /invalid|incorrect|wrong|failed|error/i.test(l));
console.log('A3 wrong-password visible message:', JSON.stringify(errLine || 'NONE FOUND'));

// keyboard focus visibility on login
await page.reload();
await page.waitForSelector('input[type="email"]');
await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
await page.screenshot({ path: SHOTS + '/q2-login-focus.png' });

// a11y basics on login
const a11yLogin = await page.evaluate(() => {
  const unlabeled = [...document.querySelectorAll('input')].filter(i => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).map(i => i.type + ':' + (i.placeholder||''));
  const noAlt = [...document.querySelectorAll('img')].filter(i => !i.alt).length;
  const unnamedButtons = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
  return { unlabeled, noAlt, unnamedButtons };
});
console.log('A4 login a11y:', JSON.stringify(a11yLogin));

// ---------- Probe B: real login, deep checks (desktop) ----------
t = Date.now();
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/select-school**', { timeout: 30000 }).catch(()=>{});
console.log('B1 login roundtrip:', Date.now() - t, 'ms, url:', page.url());
if (page.url().includes('select-school')) {
  await page.click('text=Integrated School');
  await page.waitForTimeout(800);
  const cont = page.locator('button:has-text("Continue")');
  if (await cont.count()) await cont.first().click();
  await page.waitForTimeout(1500);
}

// risk page fully settled (old shot was mid-load) — verify school scoping live
await page.click('a[href="/ai-analytics"]');
await page.waitForTimeout(8000);
await page.screenshot({ path: SHOTS + '/q3-risk-settled.png', fullPage: true });
const riskText = await page.locator('body').innerText();
console.log('B2 risk page mentions "of 19"?', /of 19/.test(riskText), '| student rows hint:', (riskText.match(/\d+ students?/g)||[]).slice(0,3));

// appointments — confirm calendar month shown vs today
await page.click('a[href="/appointments"]');
await page.waitForTimeout(3000);
const calText = await page.locator('body').innerText();
const monthShown = (calText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d/)||[])[0];
console.log('B3 calendar month shown on load:', monthShown, '(today is', new Date().toDateString() + ')');

// a11y basics on an app page (students)
await page.click('a[href="/patients"]');
await page.waitForTimeout(3000);
const a11yApp = await page.evaluate(() => {
  const unlabeled = [...document.querySelectorAll('input,select')].filter(i => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).map(i => (i.tagName + ':' + (i.getAttribute('placeholder')||i.type||'')).slice(0,40));
  const unnamedButtons = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
  return { unlabeledCount: unlabeled.length, unlabeled: unlabeled.slice(0,10), unnamedButtons };
});
console.log('B4 students-page a11y:', JSON.stringify(a11yApp));
await page.close();

// ---------- Probe C: mobile viewport (iPhone-ish 390x844) ----------
page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', m => { if (m.type() === 'error') errors.push('mobile: ' + m.text()); });
await page.goto(BASE + '/');
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.screenshot({ path: SHOTS + '/q4-mobile-login.png' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/select-school**', { timeout: 30000 }).catch(()=>{});
await page.screenshot({ path: SHOTS + '/q5-mobile-school.png' });
if (page.url().includes('select-school')) {
  await page.click('text=Integrated School');
  await page.waitForTimeout(800);
  const cont = page.locator('button:has-text("Continue")');
  if (await cont.count()) await cont.first().click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: SHOTS + '/q6-mobile-dashboard.png', fullPage: true });
await page.goto(BASE + '/patients'); // deep link now works post-e9cca597
await page.waitForTimeout(4000);
await page.screenshot({ path: SHOTS + '/q7-mobile-students.png', fullPage: true });
const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth ? document.documentElement.scrollWidth : 0);
console.log('C1 mobile /patients horizontal overflow:', hscroll ? hscroll + 'px wide (viewport 390)' : 'none');
await page.goto(BASE + '/rpc');
await page.waitForTimeout(4000);
await page.screenshot({ path: SHOTS + '/q8-mobile-rpc.png', fullPage: true });
const hscroll2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth ? document.documentElement.scrollWidth : 0);
console.log('C2 mobile /rpc horizontal overflow:', hscroll2 ? hscroll2 + 'px' : 'none');

console.log('CONSOLE ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
