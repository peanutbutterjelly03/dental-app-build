// Sprint 125 (backlog #21): the school choice must survive logout WITHOUT
// leaving a real user id in localStorage. Read-only against the app -- the only
// writes are the user's own school selection.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'D:/Users/Jerald/Documents/GitHub/dental-app-build/dental-4-12-main/project';
const BASE = 'http://localhost:5173';
const env = Object.fromEntries(
  fs.readFileSync(path.join(PROJECT, '.env'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]));

const results = [];
const check = (n, pass, d = '') => { results.push(pass); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ' -- ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const ls = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));

try {
  const login = async (email, pw) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', pw);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 });
    await page.waitForTimeout(1500);
  };
  const pickSchool = async () => {
    for (let i = 0; i < 3; i++) {
      if (!page.url().includes('select-school')) return;
      const b = page.locator('button').filter({ hasText: /Integrated School|Annex A|South Daang Hari/ }).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(1500); } else await page.waitForTimeout(800);
    }
  };

  await login('dentist@floral.com', env.SEED_DENTIST_PASSWORD);
  await pickSchool();
  check('logged in and a school is chosen', !page.url().includes('select-school'), page.url().replace(BASE, ''));

  // From /auth/me, not the localStorage cache: the cache is written by the
  // offline layer and was empty at this instant, which made the comparisons
  // below pass VACUOUSLY (checking that a string does not contain "null").
  const userId = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    return j._id || j.id || null;
  });
  if (!userId) throw new Error('could not read the signed-in user id -- the id comparisons below would be vacuous');
  check('real user id obtained for the comparison', true, userId.slice(0, 8) + '…');

  const during = await ls();
  const schoolRaw = during['selected-school'] || '';
  check('selected-school is stored', !!schoolRaw, schoolRaw);
  check('stored record does NOT contain the raw user id', !schoolRaw.includes(String(userId)), schoolRaw);
  check('stored record has no "userId" field at all', !/"userId"/.test(schoolRaw));

  // Log out and re-inspect.
  const logoutBtn = page.locator('button, a').filter({ hasText: /^\s*Logout\s*$/i }).first();
  if (await logoutBtn.count()) { await logoutBtn.click(); } else {
    await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); });
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(2500);

  const after = await ls();
  const afterRaw = after['selected-school'] || '';
  check('school choice SURVIVES logout (the feature still works)', !!afterRaw, afterRaw);
  check('nothing left after logout identifies the user', !afterRaw.includes(String(userId)) && !/"userId"/.test(afterRaw), afterRaw);
  check('the signed-in user cache IS cleared on logout', !after['floral_cached_user'], JSON.stringify(Object.keys(after)));

  // Log back in: the school must be restored, not re-asked.
  await login('dentist@floral.com', env.SEED_DENTIST_PASSWORD);
  check('returning user is NOT re-asked for a school', !page.url().includes('select-school'), page.url().replace(BASE, ''));
} catch (e) {
  check('run completed without exception', false, String(e.message).slice(0, 170));
} finally { await browser.close(); }
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
