// Offline sync, end to end, in real Chromium against a MOCK API (no database).
//
// Phase 1 — the write queue: an offline-created student, its year record, a dental
//   chart and tooth records are queued with `pending-<n>` placeholders; on reconnect
//   they must reach the server in FIFO order WITH THEIR REAL IDS, the queue must
//   empty, and the "back online" dialog must list what synced. A write whose parent
//   was discarded must be flagged, not sent.
// Phase 1b — reading what only exists on this device: while offline, those same
//   pending records must read back (student, year record, chart, teeth with the
//   offline edit applied) and NO request naming a `pending-` id may reach the server.
// Phase 2 — the per-user IndexedDB read cache: a read seen online is answered when the
//   network is gone, an unseen one fails, one user can never read another's cache,
//   sign-out clears it, and when online the live server wins.
// Phase 3 — conflicts: two offline edits collide with changes made elsewhere; the review
//   pop-up shows both versions side by side, flags what the server changed, and each
//   choice (use mine / use the server's) does what it says.
// All of it runs on the vite DEV server (no service worker involved).
//
// Usage: node verify_offline_sync.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const DEV = 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`); };

// ── mock API ────────────────────────────────────────────────────────────────
const log = [];
const gets = [];
const resolves = [];
const id24 = (tag, n = 0) => (tag + String(n)).padEnd(24, '0').slice(0, 24);
let toothN = 0;
let liveName = 'Cruz, Juan';
const studentSection = {}; // what the mock server currently holds, per student id
const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url.split('?')[0];
    if (req.method !== 'GET' && !path.startsWith('/api/sync-conflicts/')) log.push({ method: req.method, path, body });
    else gets.push(req.url);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (path.startsWith('/api/auth/')) return send(401, { error: 'no session' });
    if (path === '/api/stats/student-rows') return send(200, [{ id: id24('s'), name: liveName }]);
    if (req.method === 'POST' && path === '/api/students') return send(201, { _id: id24('s'), ...body });
    if (req.method === 'POST' && path === '/api/student-iptrs') return send(201, { _id: id24('i'), ...body });
    if (req.method === 'POST' && path === '/api/dental-charts') return send(201, { _id: id24('c'), ...body });
    if (req.method === 'POST' && path === '/api/tooth-records') return send(201, { _id: id24('t', ++toothN), ...body });
    const one = path.match(/^\/api\/students\/([0-9a-f]{24})$/);
    if (req.method === 'GET' && one) return send(200, { _id: one[1], section: studentSection[one[1]] ?? 'A', grade_level: 'Grade 3' });
    // Server-held conflicts (crudFactory + syncConflictRoutes), as the real API answers them.
    const cid = (sid) => id24('c0', Number(sid[0]));
    if (req.method === 'PUT' && one && body?._sync) {
      const cur = studentSection[one[1]] ?? 'A';
      const base = body._sync.base?.section;
      if (base !== undefined && base !== cur && body.section !== cur) {
        return send(409, { error: 'changed by someone else', conflict: true, conflictId: cid(one[1]), fields: ['section'], current: { _id: one[1], section: cur, grade_level: 'Grade 3' } });
      }
    }
    const group = path.match(/^\/api\/sync-conflicts\/record\/Student\/([0-9a-f]{24})$/);
    if (req.method === 'GET' && group) {
      const cur = studentSection[group[1]] ?? 'A';
      const mine = { _id: cid(group[1]), owner: { name: 'Dr Reyes' }, created_at: new Date().toISOString(), base: { section: 'A' }, changes: { section: 'B' } };
      const theirs = { _id: id24('d0', Number(group[1][0])), owner: { name: 'Aide Santos' }, created_at: new Date().toISOString(), base: { section: 'A' }, changes: { section: 'D' } };
      return send(200, { current: { _id: group[1], section: cur, grade_level: 'Grade 3' }, candidates: group[1][0] === '3' ? [mine, theirs] : [mine] });
    }
    const resolveCall = path.match(/^\/api\/sync-conflicts\/([0-9a-f]{24})\/resolve$/);
    if (req.method === 'POST' && resolveCall) { resolves.push({ id: resolveCall[1], action: body.action }); return send(200, { status: body.action === 'apply' ? 'applied' : 'discarded' }); }
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

  // ── Phase 1b: read the records that only exist on this device ──────────
  const reads = await page.evaluate(async () => {
    const { apiClient } = window.__m;
    const queue = await window.__m.getQueue();
    const idOf = (endpoint) => `pending-${queue.find((w) => w.endpoint === endpoint && w.method === 'POST')?.id}`;
    const sid = idOf('/students');
    const student = await apiClient.get(`/students/${sid}`);
    const iptrs = await apiClient.get(`/student-iptrs?student_id=${sid}`);
    const charts = await apiClient.get(`/dental-charts?iptr_id=${iptrs[0]._id}`);
    const teeth = await apiClient.get(`/tooth-records?chart_id=${charts[0]._id}`);
    const none = await apiClient.get(`/tooth-records?chart_id=pending-424242`);
    return { student, iptrs: iptrs.length, charts: charts.length, teeth: teeth.map((t) => `${t.tooth_number}:${t.condition}`).sort() };
  });
  check('a student that exists only on this device reads back', reads.student.last_name === 'Cruz' && reads.student._pending === true, JSON.stringify(reads.student));
  check('its year record and chart read back', reads.iptrs === 1 && reads.charts === 1, JSON.stringify(reads));
  check('its teeth read back, with the offline edit applied', JSON.stringify(reads.teeth) === JSON.stringify(['11:Filled', '12:Caries']), JSON.stringify(reads.teeth));
  check('no request naming a pending- id reached the server', !gets.some((u) => u.includes('pending-')), gets.filter((u) => u.includes('pending-')).join(' '));

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
  check('the report lists each tooth record added', (text.match(/Tooth record added/g) ?? []).length === 2, text);
  check('dialog shows the dental chart and year record', /Dental chart added/.test(text) && /School year record added/.test(text), text);
  check('the report says what could not sync and why', /Not synced/.test(text) && /discarded/.test(text), text);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/offline-sync-dialog.png` });
  await ctx.close();

  // ── Phase 2: the per-user read cache ───────────────────────────────────
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(DEV + '/');
  await p2.waitForTimeout(1500);
  await p2.evaluate(async () => {
    sessionStorage.setItem('floral_cached_user', JSON.stringify({ id: 'u1', name: 'One', email: 'one@x.test', role: 'dentist', schools: [] }));
    window.__m = { ...(await import('/src/app/api/client.ts')), ...(await import('/src/app/offline/offlineCache.ts')) };
  });
  const seen = await p2.evaluate(() => window.__m.apiClient.get('/stats/student-rows'));
  check('a read works online', seen[0]?.name === 'Cruz, Juan');
  await p2.waitForTimeout(400); // let the background save finish

  await ctx2.setOffline(true);
  const off = await p2.evaluate(() => window.__m.apiClient.get('/stats/student-rows').catch((e) => `ERR ${e.message}`));
  check('the same read is answered from the cache when offline', Array.isArray(off) && off[0]?.name === 'Cruz, Juan', JSON.stringify(off));
  const unseen = await p2.evaluate(() => window.__m.apiClient.get('/students/' + 'f'.repeat(24)).then(() => 'answered', (e) => e.constructor.name));
  check('a read never seen online fails offline (and is not mistaken for a server answer)', unseen === 'Error', unseen);
  const other = await p2.evaluate(() => {
    sessionStorage.setItem('floral_cached_user', JSON.stringify({ id: 'u2', name: 'Two', email: 'two@x.test', role: 'dentist', schools: [] }));
    return window.__m.apiClient.get('/stats/student-rows').then(() => 'LEAKED', () => 'blocked');
  });
  check("another user on this device cannot read the first user's cache", other === 'blocked', other);
  await p2.evaluate(() => sessionStorage.setItem('floral_cached_user', JSON.stringify({ id: 'u1', name: 'One', email: 'one@x.test', role: 'dentist', schools: [] })));
  await p2.evaluate(() => window.__m.clearOfflineReadCaches());
  const cleared = await p2.evaluate(() => window.__m.apiClient.get('/stats/student-rows').then(() => 'still there', () => 'gone'));
  check('sign-out clears the cache', cleared === 'gone', cleared);

  await ctx2.setOffline(false);
  liveName = 'Fresh, Maria';
  const fresh = await p2.evaluate(() => window.__m.apiClient.get('/stats/student-rows'));
  check('when online the live server answers', fresh[0]?.name === 'Fresh, Maria', JSON.stringify(fresh));
  await ctx2.close();
  // ── Phase 3: conflicts and the review pop-up ───────────────────────────
  const A = id24('1'), B = id24('2'), C = id24('3');
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p3 = await ctx3.newPage();
  await p3.goto(DEV + '/');
  await p3.waitForTimeout(1500);
  await p3.evaluate(async () => {
    sessionStorage.setItem('floral_cached_user', JSON.stringify({ id: 'u1', name: 'One', email: 'one@x.test', role: 'dentist', schools: [] }));
    window.__m = { ...(await import('/src/app/api/client.ts')), ...(await import('/src/app/offline/queueProcessor.ts')), ...(await import('/src/app/offline/db.ts')) };
  });
  await p3.evaluate(async (ids) => { for (const id of ids) await window.__m.apiClient.get(`/students/${id}`); }, [A, B, C]);
  await p3.waitForTimeout(500); // the saved copy is what each edit is later compared with
  await ctx3.setOffline(true);
  await p3.evaluate(async (ids) => { for (const id of ids) await window.__m.apiClient.put(`/students/${id}`, { section: 'B' }); }, [A, B, C]);
  for (const id of [A, B, C]) studentSection[id] = 'C'; // someone else edited all three in the meantime
  log.length = 0;
  await ctx3.setOffline(false);
  await p3.evaluate(() => window.__m.processQueue());
  await p3.waitForTimeout(600);
  const sentEnvelope = log.filter((l) => l.method === 'PUT' && l.path.startsWith('/api/students/'));
  check('each edit was sent with its id and the values it started from', sentEnvelope.length === 3 && sentEnvelope.every((l) => /^[A-Za-z0-9-]{8,64}$/.test(l.body._sync?.operationId ?? '') && l.body._sync.base.section === 'A'), JSON.stringify(sentEnvelope.map((l) => l.body)));
  const held = await p3.evaluate(async () => (await window.__m.getQueue()).map((w) => ({ s: w.status, c: w.serverConflictId })));
  check("the server's 409 held all three edits, each remembering the server's conflict id", held.length === 3 && held.every((h) => h.s === 'conflict' && /^c0/.test(h.c ?? '')), JSON.stringify(held));
  let summary = (await p3.locator('dialog[open]').innerText().catch(() => '')) || '';
  check('the summary offers to review the clashes', /Review changes/.test(summary) && /Held for your review/.test(summary), summary);
  await p3.getByRole('button', { name: 'Review changes' }).first().click();
  await p3.waitForTimeout(800);
  const review = (await p3.locator('dialog[open]').innerText().catch(() => '')) || '';
  check('the review pop-up lists all three clashes', (review.match(/Student record updated/g) ?? []).length === 3, review);
  check('it shows your version beside the server version', /Your version/.test(review) && /Server version/.test(review), review);
  check('it flags what the server changed and what you started from', /Changed on the server/.test(review) && /Started from: A/.test(review), review);
  check("it lists another person's waiting version of the same record", /Also waiting on this record: Aide Santos/.test(review), review);
  if (process.env.SHOTS_DIR) await p3.screenshot({ path: `${process.env.SHOTS_DIR}/offline-conflict-review.png`, fullPage: false });

  const cards = p3.locator('dialog[open] section').filter({ hasText: 'Student record updated' });
  // 1. Use my version on the first card: asks to confirm, then the SERVER is told to apply it.
  await p3.getByRole('button', { name: 'Use my version' }).first().click();
  check('each choice asks to be confirmed', await p3.getByText('will replace what the server has').count() === 1);
  await p3.getByRole('button', { name: 'Yes, use my version' }).click();
  await p3.waitForTimeout(800);
  check('"Use my version" tells the server to apply that edit', resolves.length === 1 && resolves[0].action === 'apply' && resolves[0].id === id24('c0', 1), JSON.stringify(resolves));
  check('and that device drops its queued copy', (await p3.evaluate(async () => (await window.__m.getQueue()).length)) === 2);

  // 2. Use the server version on the next one: the server is told to discard it.
  await p3.getByRole('button', { name: 'Use the server version' }).first().click();
  await p3.getByRole('button', { name: 'Yes, use the server version' }).click();
  await p3.waitForTimeout(800);
  check('"Use the server version" tells the server to discard that edit', resolves.length === 2 && resolves[1].action === 'discard' && resolves[1].id === id24('c0', 2), JSON.stringify(resolves));

  // 3. Use someone else's waiting version on the last one.
  await p3.getByRole('button', { name: "Use Aide Santos's version" }).click();
  check("choosing someone else's version says whose it is and what happens to yours", await p3.getByText("Aide Santos's version will be saved onto the record, and your version will be discarded.").count() === 1);
  await p3.getByRole('button', { name: "Yes, use Aide Santos's version" }).click();
  await p3.waitForTimeout(800);
  check("the server is told to apply THEIR edit", resolves.length === 3 && resolves[2].action === 'apply' && resolves[2].id === id24('d0', 3), JSON.stringify(resolves));
  check('nothing was sent as a plain edit while resolving', log.filter((l) => l.method === 'PUT' && l.path.startsWith('/api/students/')).length === 3);
  const after3 = await p3.evaluate(async () => (await window.__m.getQueue()).length);
  check('the queue is empty and the pop-up closes itself', after3 === 0 && (await p3.locator('dialog[open]').count()) === 0, `${after3}`);
  await ctx3.close();
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
  api.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
