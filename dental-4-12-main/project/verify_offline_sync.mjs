// Offline sync, end to end, in real Chromium against a MOCK API (no database).
//
// Phase 1 (vite dev server)  — the write queue: an offline-created student, its
//   year record, a dental chart and tooth records are queued with `pending-<n>`
//   placeholders; on reconnect they must reach the server in FIFO order WITH
//   THEIR REAL IDS, the queue must empty, and the "back online" dialog must list
//   what synced. A write whose parent was discarded must be flagged, not sent.
// Phase 2 (vite preview, real service worker) — offline READS: a /api/stats/*
//   response seen online is served from cache when the network is gone, and an
//   unseen one still fails.
//
// Usage: npm run build && node verify_offline_sync.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const DEV = 'http://localhost:5173';
const PREVIEW = 'http://localhost:4173';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`); };

// ── mock API ────────────────────────────────────────────────────────────────
const log = [];
const id24 = (tag, n = 0) => (tag + String(n)).padEnd(24, '0').slice(0, 24);
let toothN = 0;
const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url.split('?')[0];
    if (req.method !== 'GET') log.push({ method: req.method, path, body });
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (path.startsWith('/api/auth/')) return send(401, { error: 'no session' });
    if (path === '/api/stats/student-rows') return send(200, [{ id: id24('s'), name: 'Cruz, Juan' }]);
    if (req.method === 'POST' && path === '/api/students') return send(201, { _id: id24('s'), ...body });
    if (req.method === 'POST' && path === '/api/student-iptrs') return send(201, { _id: id24('i'), ...body });
    if (req.method === 'POST' && path === '/api/dental-charts') return send(201, { _id: id24('c'), ...body });
    if (req.method === 'POST' && path === '/api/tooth-records') return send(201, { _id: id24('t', ++toothN), ...body });
    if (req.method === 'PUT') return send(200, { _id: path.split('/').pop(), ...body });
    send(200, []);
  });
});
await new Promise((r) => api.listen(4000, r));

const servers = [];
const start = (args) => {
  const p = spawn('npx', ['vite', ...args], { stdio: 'ignore', shell: process.platform === 'win32' });
  servers.push(p);
};
const waitFor = async (url) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${url} did not start`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  // ── Phase 1: write queue ────────────────────────────────────────────────
  start(['--port', '5173', '--strictPort']);
  await waitFor(DEV);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(DEV + '/');
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    sessionStorage.setItem('floral_cached_user', JSON.stringify({ id: 'u1', name: 'Tester', email: 't@x.test', role: 'dentist', schools: [] }));
    window.__m = {
      ...(await import('/src/app/api/client.ts')),
      ...(await import('/src/app/offline/queueProcessor.ts')),
      ...(await import('/src/app/offline/db.ts')),
    };
  });

  await ctx.setOffline(true);
  const queued = await page.evaluate(async () => {
    const { apiClient } = window.__m;
    const student = await apiClient.post('/students', { last_name: 'Cruz', first_name: 'Juan' });
    const iptr = await apiClient.post('/student-iptrs', { student_id: student._id, school_year: '2026-2027' });
    const chart = await apiClient.post('/dental-charts', { iptr_id: iptr._id, date_charted: '2026-10-03' });
    const t1 = await apiClient.post('/tooth-records', { chart_id: chart._id, tooth_number: 11, condition: 'Caries' });
    const t2 = await apiClient.post('/tooth-records', { chart_id: chart._id, tooth_number: 12, condition: 'Caries' });
    await apiClient.put(`/tooth-records/${t1._id}`, { chart_id: chart._id, tooth_number: 11, condition: 'Filled' });
    // Orphan: points at a record that was never queued (as if its parent was discarded).
    await apiClient.post('/student-iptrs', { student_id: 'pending-99999', school_year: '2025-2026' });
    return { pendings: [student, iptr, chart, t1, t2].map((r) => r._pending === true), count: (await window.__m.getQueue()).length };
  });
  check('offline writes return pending placeholders', queued.pendings.every(Boolean));
  check('all 7 writes are queued locally', queued.count === 7, `got ${queued.count}`);
  check('nothing reached the server while offline', log.length === 0, JSON.stringify(log));

  await ctx.setOffline(false);
  await page.evaluate(() => window.__m.processQueue());
  await page.waitForTimeout(500);

  const paths = log.map((l) => `${l.method} ${l.path}`);
  check('synced in FIFO order', JSON.stringify(paths.slice(0, 5)) === JSON.stringify([
    'POST /api/students', 'POST /api/student-iptrs', 'POST /api/dental-charts', 'POST /api/tooth-records', 'POST /api/tooth-records',
  ]), paths.join(' | '));
  const iptrCall = log.find((l) => l.path === '/api/student-iptrs');
  check("year record carries the student's REAL id", iptrCall?.body.student_id === id24('s'), JSON.stringify(iptrCall?.body));
  const chartCall = log.find((l) => l.path === '/api/dental-charts');
  check("chart carries the year record's REAL id", chartCall?.body.iptr_id === id24('i'), JSON.stringify(chartCall?.body));
  const toothCalls = log.filter((l) => l.path === '/api/tooth-records' && l.method === 'POST');
  check("tooth records carry the chart's REAL id", toothCalls.length === 2 && toothCalls.every((t) => t.body.chart_id === id24('c')), JSON.stringify(toothCalls.map((t) => t.body)));
  const put = log.find((l) => l.method === 'PUT');
  check('a PUT to a pending record is sent to the real URL', put?.path === `/api/tooth-records/${id24('t', 1)}`, put?.path);
  check('no placeholder ever reached the server', !JSON.stringify(log).includes('pending-'), JSON.stringify(log).match(/.{30}pending-.{10}/)?.[0]);
  check('each record was created exactly once', log.filter((l) => l.path === '/api/students').length === 1 && log.filter((l) => l.path === '/api/dental-charts').length === 1);

  const after = await page.evaluate(async () => (await window.__m.getQueue()).map((w) => ({ status: w.status, endpoint: w.endpoint, msg: w.errorMessage })));
  check('only the orphaned write is left, flagged as failed (not sent)', after.length === 1 && after[0].status === 'failed' && /discarded/.test(after[0].msg ?? ''), JSON.stringify(after));

  const dialog = page.locator('dialog[open]');
  check('the "back online" dialog opened', await dialog.count() === 1);
  const text = (await dialog.innerText().catch(() => '')) || '';
  check('dialog lists the student by name', text.includes('Cruz, Juan'), text);
  check('dialog groups tooth records with a count', /Tooth record added\s*×2/.test(text), text);
  check('dialog shows the dental chart and year record', /Dental chart added/.test(text) && /School year record added/.test(text), text);
  check('dialog reports the change that could not sync', /Not saved/.test(text) && /discarded/.test(text), text);
  await page.screenshot({ path: process.env.SHOTS_DIR ? `${process.env.SHOTS_DIR}/offline-sync-dialog.png` : 'offline-sync-dialog.png' });
  await ctx.close();
  servers.pop().kill();

  // ── Phase 2: offline reads through the real service worker ─────────────
  start(['preview', '--port', '4173', '--strictPort']);
  await waitFor(PREVIEW);
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(PREVIEW + '/');
  await page2.evaluate(() => navigator.serviceWorker.ready);
  await page2.reload(); // let the worker take control of the page
  await page2.waitForFunction(() => !!navigator.serviceWorker.controller);

  const online = await page2.evaluate(() => fetch('/api/stats/student-rows').then((r) => r.json()));
  check('stats read works online', online[0]?.name === 'Cruz, Juan');
  await page2.waitForTimeout(500); // let the worker finish writing the cache copy

  await ctx2.setOffline(true);
  const offline = await page2.evaluate(() => fetch('/api/stats/student-rows').then((r) => r.json()).catch((e) => `ERR ${e.message}`));
  check('stats read is served from cache when offline', Array.isArray(offline) && offline[0]?.name === 'Cruz, Juan', JSON.stringify(offline));
  const unseen = await page2.evaluate(() => fetch('/api/stats/never-seen').then((r) => r.status).catch(() => 'network-error'));
  check('a stats read never seen online still fails offline', unseen === 'network-error', String(unseen));
  await ctx2.setOffline(false);

  // Online again: the network must win over the cache (no stale numbers).
  api.removeAllListeners('request');
  api.on('request', (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ id: 'x', name: 'Fresh' }])); });
  const fresh = await page2.evaluate(() => fetch('/api/stats/student-rows').then((r) => r.json()));
  check('when online the live server wins over the cached copy', fresh[0]?.name === 'Fresh', JSON.stringify(fresh));
  await ctx2.close();
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
  api.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
