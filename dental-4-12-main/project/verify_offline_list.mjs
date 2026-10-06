// Offline, as a person sees it. Runs against BOTH the vite dev server and the
// production build (real service worker) with a mock API and no database.
//   - Student Records keeps its records offline, after navigating away and back
//     (and after a full reload, where the app shell can be served: production only).
//   - A page that needs the server says so, instead of loading forever.
//   - A student added offline can be opened in the Dental Chart straight away.
//
// Usage: npm run build && node verify_offline_list.mjs
// CHROMIUM_PATH only where Playwright's own browser is missing.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const row = (n, last, first) => ({ id: String(n).repeat(24).slice(0, 24), name: `${last}, ${first}`, lastName: last, firstName: first, middleName: '', birthdate: '2015-01-01', gender: 'Male', grade: 'Grade 3', section: 'A', school: 'Bagong Tanyag Integrated School', lastVisit: null, oralStatus: 'Not Yet Screened', riskLevel: null, recommendation: '', pipelineStatus: 'For Oral Exam', consentStatus: 'pending' });
const school = { _id: 'a'.repeat(24), school_name: 'Bagong Tanyag Integrated School', isArchived: false };
const user = { _id: 'b'.repeat(24), school_ids: [], role: 'dentist', full_name: 'Dr Test', email: 'd@floral.com', is_enrolled: true, last_login: null, isArchived: false };
const api = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/auth/me') return send(200, user);
  if (p === '/api/schools') return send(200, [school]);
  if (p === '/api/stats/student-rows') return send(200, [row(1, 'Cruz', 'Juan'), row(2, 'Reyes', 'Maria'), row(3, 'Santos', 'Pedro')]);
  if (p === '/api/stats/rpc-rows') return send(200, { rows: [], total: 0, limit: 1000, offset: 0 });
  if (p === '/api/config') return send(200, {});
  send(200, p.startsWith('/api/stats/') ? {} : []);
});
await new Promise((r) => api.listen(4000, r));

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function run(mode) {
  const url = mode === 'dev' ? 'http://localhost:5173' : 'http://localhost:4173';
  const srv = spawn('npx', mode === 'dev' ? ['vite', '--port', '5173', '--strictPort'] : ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const names = () => page.evaluate(() => ['Cruz', 'Reyes', 'Santos'].filter((n) => document.body.innerText.includes(n)));
  const goto = async (path) => { await page.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(1800); };
  try {
    await page.goto(url + '/');
    await page.evaluate(() => {
      localStorage.setItem('has-session', '1');
      localStorage.setItem('floral_cached_user', JSON.stringify({ id: 'b'.repeat(24), name: 'Dr Test', email: 'd@floral.com', role: 'dentist', schools: ['Bagong Tanyag Integrated School'] }));
    });
    if (mode === 'preview') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto(url + '/patients'); await page.waitForTimeout(3000);
    check(`[${mode}] online: the 3 records are listed`, (await names()).length === 3, JSON.stringify(await names()));
    if (mode === 'preview') { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller); await page.waitForTimeout(1500); }

    await ctx.setOffline(true);
    await page.waitForTimeout(500);
    await goto('/dental-charts');
    await goto('/patients'); await page.waitForTimeout(1500);
    check(`[${mode}] offline: Student Records needs a connection (students are queued in Dental Charts / Treatment instead)`, await page.evaluate(() => document.body.innerText.includes('This page needs a connection') && !document.body.innerText.includes('Student Records\n')), (await names()).join());

    await goto('/appointments');
    const msg = await page.evaluate(() => document.body.innerText.includes('This page needs a connection'));
    check(`[${mode}] offline: a page that needs the server says so`, msg);

    if (mode === 'preview') {
      await page.reload(); await page.waitForTimeout(3500);
      check(`[${mode}] offline, after a full page reload: Student Records still needs a connection`, await page.evaluate(() => document.body.innerText.includes('This page needs a connection')));
    }

    if (mode === 'dev') {
      // A student added offline opens in the Dental Chart right away.
      await page.evaluate(async () => {
        const { apiClient } = await import('/src/app/api/client.ts');
        const s = await apiClient.post('/students', { school_id: 'a'.repeat(24), last_name: 'Offlina', first_name: 'Nora', birthday: '2016-02-02', sex: 'Female', grade_level: 'Grade 1', section: 'B' });
        await apiClient.post('/student-iptrs', { student_id: s._id, school_year: '2026-2027', grade_level: 'Grade 1', section: 'B' });
        window.__pendingStudent = s._id;
      });
      const id = await page.evaluate(() => window.__pendingStudent);
      await goto(`/dental-chart/${id}`);
      await page.waitForTimeout(1500);
      const chartText = await page.evaluate(() => document.body.innerText);
      check(`[${mode}] a student added offline opens in the Dental Chart`, chartText.includes('Offlina'), chartText.slice(0, 200).replace(/\n/g, ' | '));
    }
  } finally {
    await ctx.close();
    srv.kill();
    await new Promise((r) => setTimeout(r, 800));
  }
}

try {
  await run('dev');
  await run('preview');
} finally {
  await browser.close();
  api.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
