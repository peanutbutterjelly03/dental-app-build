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
let bundleHits = 0;
let bundleMode = 'missing'; // 'missing': the server has no offline download yet (404); 'ok': it answers
const api = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/auth/me') return send(200, user);
  if (p === '/api/schools') return send(200, [school]);
  if (p === '/api/stats/student-rows') return send(200, [row(1, 'Cruz', 'Juan'), row(2, 'Reyes', 'Maria'), row(3, 'Santos', 'Pedro')]);
  if (p === '/api/stats/rpc-rows') return send(200, { rows: [], total: 0, limit: 1000, offset: 0 });
  if (p === '/api/config') return send(200, {});
  if (p === '/api/offline/version') return send(200, { at: '2026-10-03T00:00:00.000Z' });
  if (p === '/api/offline/bundle') {
    bundleHits++;
    if (bundleMode === 'missing') return send(404, { error: 'Not found' });
    const empty = Object.fromEntries(['student-iptrs', 'medical-histories', 'dietary-social-habits', 'oral-health-conditions', 'dental-charts', 'tooth-records', 'preventive-care-records', 'treatments', 'referrals'].map((k) => [k, []]));
    return send(200, { students: [{ _id: '1'.repeat(24), school_id: 'a'.repeat(24), last_name: 'Cruz', first_name: 'Juan' }], ...empty, next: null, total: 1 });
  }
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
    check(`[${mode}] offline, after leaving Student Records and coming back: records still listed`, (await names()).length === 3, JSON.stringify(await names()));

    await goto('/appointments');
    const msg = await page.evaluate(() => document.body.innerText.includes('This page needs a connection'));
    check(`[${mode}] offline: a page that needs the server says so`, msg);
    await goto('/patients'); await page.waitForTimeout(1200);

    if (mode === 'preview') {
      await page.reload(); await page.waitForTimeout(3500);
      check(`[${mode}] offline, after a full page reload: records still listed`, (await names()).length === 3, JSON.stringify(await names()));
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

      // A failed download says why, and a chart that is not on the device explains itself.
      await goto('/patients');
      const paused = await page.evaluate(() => document.body.innerText);
      check(`[${mode}] a download the server cannot serve says WHY, not just "paused"`, /Offline data paused/.test(paused) && /does not have the offline download yet/.test(paused), paused.slice(0, 400).replace(/\n/g, ' | '));
      await goto(`/dental-chart/${'9'.repeat(24)}`);
      const missing = await page.evaluate(() => document.body.innerText);
      check(`[${mode}] a chart that was never downloaded explains itself and offers both ways back`, /not been downloaded/.test(missing) && /Back to Student Records/.test(missing) && /Back to Dental Charts/.test(missing) && /Offline data paused/.test(missing), missing.slice(0, 400).replace(/\n/g, ' | '));
      // The connection returns: the download retries BY ITSELF (still failing: the server has no download yet).
      const hitsBefore = bundleHits;
      await ctx.setOffline(false);
      await page.waitForTimeout(2500);
      check(`[${mode}] when the connection returns, the download retries by itself`, bundleHits > hitsBefore, `${hitsBefore} -> ${bundleHits}`);
      await goto('/patients');
      // The offline-created student synced on reconnect, so the back-online summary is open: dismiss it.
      if (await page.getByRole('button', { name: 'Close' }).count()) await page.getByRole('button', { name: 'Close' }).first().click();
      // "Try again" while the server still cannot serve it: stays honest, no crash.
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.waitForTimeout(1500);
      check(`[${mode}] "Try again" against a server that still cannot serve it keeps saying why`, /does not have the offline download yet/.test(await page.evaluate(() => document.body.innerText)));
      // The server is updated: "Try again" now completes the download.
      bundleMode = 'ok';
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.waitForTimeout(2500);
      const recovered = await page.evaluate(() => document.body.innerText);
      check(`[${mode}] "Try again" completes the download once the server can serve it`, /Offline data ready: 1 students/.test(recovered), recovered.slice(0, 400).replace(/\n/g, ' | '));
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
