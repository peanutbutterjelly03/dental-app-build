// Dental chart marking modes, as a person uses them (mock API, no database):
//   Single tooth: clicking a tooth opens a popover with the charting codes (condition) and
//   the tooth treatment codes; picking one marks that tooth. Bulk: arm a code, apply to areas.
// Usage: CHROMIUM_PATH=/opt/pw-browsers/chromium node verify_chart_marking.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const sid = 'd'.repeat(24), iptr = '1'.repeat(24);
const school = { _id: 'a'.repeat(24), school_name: 'Bagong Tanyag Integrated School', isArchived: false };
const user = { _id: 'b'.repeat(24), school_ids: [], role: 'dentist', full_name: 'Dr. Maria Santos', email: 'd@f.com', is_enrolled: true, isArchived: false };
const student = { _id: sid, school_id: school._id, last_name: 'Andaya', first_name: 'Xian Rex', birthday: '2019-01-01', sex: 'Male', grade_level: 'Grade 1', section: 'Sampaguita' };
const api = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/auth/me') return send(200, user);
  if (p === '/api/schools') return send(200, [school]);
  if (p === `/api/students/${sid}`) return send(200, student);
  if (p === '/api/student-iptrs' && u.searchParams.get('student_id') === sid) return send(200, [{ _id: iptr, student_id: sid, school_year: '2026-2027', grade_level: 'Grade 1', section: 'Sampaguita' }]);
  if (p === '/api/stats/student-nav') return send(200, []);
  if (p === '/api/stats/rpc-rows') return send(200, { rows: [], total: 0, limit: 1000, offset: 0 });
  send(200, p.startsWith('/api/stats/') ? {} : []);
});
await new Promise((r) => api.listen(4000, r));
const srv = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:5173')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: Number(process.env.W || 1280), height: 1000 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
try {
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => {
    localStorage.setItem('has-session', '1');
    localStorage.setItem('floral_cached_user', JSON.stringify({ id: 'b'.repeat(24), name: 'Dr. Maria Santos', email: 'd@f.com', role: 'dentist', schools: ['Bagong Tanyag Integrated School'] }));
  });
  await page.goto(`http://localhost:5173/dental-chart/${sid}?tab=chart`); await page.waitForTimeout(3500);
  const toggle = page.getByRole('group', { name: 'Marking mode' });
  check('the Single tooth / Bulk toggle shows while charting, Single first', (await toggle.count()) === 1 && (await toggle.getByRole('button', { name: 'Single tooth' }).getAttribute('aria-pressed')) === 'true', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  check('Single mode says to click a tooth', await page.getByText('Click a tooth on the chart to choose its condition or treatment code.').count() === 1);
  await page.locator('[data-tooth="16"]').first().click();
  const pop = page.getByRole('dialog', { name: 'Tooth 16 codes' });
  check('clicking a tooth opens its code popover', await pop.count() === 1);
  check('the popover shows the charting (condition) codes', await pop.getByText('Charting codes: condition').count() === 1 && await pop.getByRole('button', { name: /^D$/ }).count() >= 1);
  check('and the treatment codes section (locked until a condition is set)', await pop.getByText('Tooth treatment codes').count() === 1 && await pop.getByText(/Set a condition first/).count() === 1);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await pop.getByRole('button', { name: /^D$/ }).first().click();
  check('picking a condition marks the tooth and closes the popover', (await page.getByRole('dialog', { name: 'Tooth 16 codes' }).count()) === 0 && /D/.test(await page.locator('[data-tooth="16"]').first().innerText()), await page.locator('[data-tooth="16"]').first().innerText());
  await page.locator('[data-tooth="16"]').first().click();
  const pop2 = page.getByRole('dialog', { name: 'Tooth 16 codes' });
  check('once a condition is set the treatment codes unlock', await pop2.getByText(/Set a condition first/).count() === 0 && await pop2.getByRole('button', { name: /^PF$/ }).count() === 1);
  await pop2.getByRole('button', { name: /^PF$/ }).click();
  check('picking a treatment marks the tooth', /PF/.test(await page.locator('[data-tooth="16"]').first().innerText()), await page.locator('[data-tooth="16"]').first().innerText());
  await page.locator('[data-tooth="16"]').first().click();
  await page.getByRole('button', { name: 'Clear tooth' }).click();
  check('Clear tooth empties it', !/D|PF/.test((await page.locator('[data-tooth="16"]').first().innerText()).replace(/16/, '')));
  // Bulk
  await page.getByRole('button', { name: 'Bulk' }).click();
  check('Bulk mode shows the area chooser and no popover on click', await page.getByText('Apply to').count() === 1);
  await page.locator('[data-tooth="11"]').first().click();
  check('in Bulk mode a tooth click opens no popover', await page.getByRole('dialog', { name: /Tooth 11 codes/ }).count() === 0);
  await page.getByRole('button', { name: /^D\/d$/ }).first().click();
  await page.getByRole('button', { name: 'Whole mouth' }).click();
  const apply = page.getByRole('button', { name: /^Apply to \d+ teeth$/ });
  check('Bulk apply counts the teeth it will mark', await apply.count() === 1, await page.locator('button:has-text("Apply")').allInnerTexts());
  await apply.click(); await page.waitForTimeout(300);
  check('Bulk marked the teeth', /D/.test(await page.locator('[data-tooth="21"]').first().innerText()));
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { check('script ran to the end', false, e.message); }
finally { await browser.close(); srv.kill(); api.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
