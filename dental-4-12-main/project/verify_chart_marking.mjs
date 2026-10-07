// Dental chart marking modes, as a person uses them (mock API, no database):
//   Select teeth first (click or drag), then pick a code from the popup that opens at the
//   selection; a Condition | Treatment switch in the chart's corner picks which codes it shows.
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
  const sw = page.getByRole('group', { name: 'Mark as' });
  check('the Condition | Treatment switch shows while charting, Condition first', (await sw.count()) === 1 && (await sw.getByRole('button', { name: 'Condition' }).getAttribute('aria-pressed')) === 'true', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  check('Treatment is locked until a tooth has a condition', await sw.getByRole('button', { name: 'Treatment' }).isDisabled());
  // The tab strip and year bar scroll with the page; they are not pinned (user, 2026-10-07).
  const scrolled = await page.evaluate(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Medical History');
    const before = tab.getBoundingClientRect().top;
    window.scrollTo(0, 900); document.querySelectorAll('main, [class*="overflow-y"]').forEach((el) => { el.scrollTop = 900; });
    await new Promise((r) => setTimeout(r, 300));
    return { before, after: tab.getBoundingClientRect().top };
  });
  check('the tab strip scrolls away with the page (not pinned)', scrolled.after < scrolled.before - 50, JSON.stringify(scrolled));
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('main, [class*="overflow-y"]').forEach((el) => { el.scrollTop = 0; }); });
  const popup = page.getByRole('dialog', { name: 'Codes for the selected teeth' });
  check('no popup before any tooth is selected', await popup.count() === 0);
  // Select two teeth, then the popup offers the Condition codes.
  await page.locator('[data-tooth="16"]').first().click();
  await page.locator('[data-tooth="26"]').first().click();
  check('selecting teeth opens the popup for them', await popup.count() === 1 && /2 teeth selected/.test(await popup.innerText()), await popup.innerText().catch(() => ''));
  check('Condition mode shows the condition codes (D/d, F/f, More)', await popup.getByRole('button', { name: 'D/d' }).count() === 1 && await popup.getByRole('button', { name: /More \(\d\)/ }).count() === 1);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await popup.getByRole('button', { name: 'F/f' }).click();
  check('picking a code marks every selected tooth and closes the popup', await popup.count() === 0 && /F/.test(await page.locator('[data-tooth="16"]').first().innerText()) && /F/.test(await page.locator('[data-tooth="26"]').first().innerText()));
  // Drag across three teeth.
  const a = await page.locator('[data-tooth="14"]').first().boundingBox();
  const z = await page.locator('[data-tooth="12"]').first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 8 }); await page.mouse.up();
  check('dragging across teeth selects all of them', /3 teeth selected/.test(await popup.innerText().catch(() => '')), await popup.innerText().catch(() => ''));
  await page.keyboard.press('Escape');
  check('Escape clears the selection and closes the popup', await popup.count() === 0);
  // Treatment mode
  await sw.getByRole('button', { name: 'Treatment' }).click();
  await page.locator('[data-tooth="12"]').first().click({ force: true });
  check('in Treatment mode a tooth without a condition cannot be selected', await popup.count() === 0);
  await page.locator('[data-tooth="16"]').first().click();
  check('Treatment mode shows the treatment codes', await popup.getByRole('button', { name: 'PFS' }).count() === 1 && await popup.getByRole('button', { name: 'SDF' }).count() === 1);
  await popup.getByRole('button', { name: 'PF', exact: true }).click();
  check('picking a treatment marks the tooth', /PF/.test(await page.locator('[data-tooth="16"]').first().innerText()), await page.locator('[data-tooth="16"]').first().innerText());
  // Clear All lives in the corner and asks first
  await page.getByRole('button', { name: /^Clear All \(\d+\)$/ }).click();
  check('Clear All (n) in the corner asks before clearing', await page.getByText(/Clear all 1 treatments\?/i).count() >= 1, (await page.evaluate(() => document.body.innerText)).slice(-400));
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) { check('script ran to the end', false, e.message); }
finally { await browser.close(); srv.kill(); api.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
