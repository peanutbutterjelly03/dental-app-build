// The sync report, as a person sees it, against a mock API that applies the real
// clash rule (a field changed since the edit started, and not equal to the edit).
//   - The same field edited twice offline syncs both edits with NO clash (false-clash fix).
//   - A genuine clash (someone else changed a field) is held and shown as needing attention.
//   - The report lists every change, the versions of a repeatedly edited field, and a
//     student with nothing to sync.
//   - Keeping an earlier version sends it as a new edit.
// Usage: CHROMIUM_PATH=/opt/pw-browsers/chromium node verify_sync_report.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const sid = 'd'.repeat(24), sid2 = 'e'.repeat(24), iptr = '1'.repeat(24), chart = '3'.repeat(24);
const school = { _id: 'a'.repeat(24), school_name: 'Bagong Tanyag Integrated School', isArchived: false };
const user = { _id: 'b'.repeat(24), school_ids: [], role: 'dentist', full_name: 'Dr. Maria Santos', email: 'd@f.com', is_enrolled: true, isArchived: false };
const students = {
  [sid]: { _id: sid, school_id: school._id, last_name: 'Andaya', first_name: 'Xian Rex', birthday: '2019-01-01', sex: 'Male', grade_level: 'Grade 1', section: 'Sampaguita', contact_number: '0917' },
  [sid2]: { _id: sid2, school_id: school._id, last_name: 'Uy', first_name: 'Gabriel', birthday: '2019-01-01', sex: 'Male', grade_level: 'Grade 1', section: 'Rose', contact_number: '0918' },
};
const state = { chart: { _id: chart, iptr_id: iptr, date_charted: '2026-09-01', dmf_index: 0, notes: '' }, puts: [] };
const row = (s) => ({ id: s._id, name: `${s.last_name}, ${s.first_name}`, lastName: s.last_name, firstName: s.first_name, middleName: '', birthdate: '2019-01-01', gender: 'Male', grade: s.grade_level, section: s.section, school: school.school_name, lastVisit: null, oralStatus: 'x', riskLevel: null, recommendation: '', pipelineStatus: 'For Oral Exam', consentStatus: 'pending' });
const clash = (base, upd, cur) => Object.keys(upd).filter((k) => k in base && JSON.stringify(base[k]) !== JSON.stringify(cur[k]) && JSON.stringify(upd[k]) !== JSON.stringify(cur[k]));
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})); });
const api = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'PUT' && p === `/api/dental-charts/${chart}`) {
    const body = await readBody(req); const sync = body._sync; delete body._sync;
    state.puts.push(body);
    if (sync && clash(sync.base, body, state.chart).length) return send(409, { conflict: true, conflictId: 'f'.repeat(24), current: state.chart });
    Object.assign(state.chart, body); return send(200, state.chart);
  }
  if (req.method === 'PUT' && p === `/api/students/${sid}`) { await readBody(req); return send(409, { conflict: true, conflictId: 'f'.repeat(24), current: { ...students[sid], contact_number: '0999' } }); }
  if (req.method === 'POST') { await readBody(req); return send(201, { _id: 'c'.repeat(24) }); }
  if (p === '/api/auth/me') return send(200, user);
  if (p === '/api/schools') return send(200, [school]);
  if (p === '/api/stats/student-rows') return send(200, Object.values(students).map(row));
  if (p === '/api/stats/student-nav') return send(200, []);
  if (p === '/api/stats/rpc-rows') return send(200, { rows: [], total: 0, limit: 1000, offset: 0 });
  let m;
  if ((m = p.match(/^\/api\/students\/([a-f0-9]{24})$/))) return send(200, students[m[1]]);
  if (p === '/api/student-iptrs' && u.searchParams.get('student_id') === sid) return send(200, [{ _id: iptr, student_id: sid, school_year: '2026-2027', grade_level: 'Grade 1', section: 'Sampaguita' }]);
  if (p === '/api/dental-charts' && u.searchParams.get('iptr_id')) return send(200, [state.chart]);
  if (p.startsWith('/api/sync-conflicts/record/')) return send(200, { current: state.chart, candidates: [] });
  send(200, p.startsWith('/api/stats/') ? {} : []);
});
await new Promise((r) => api.listen(4000, r));
const srv = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:5173')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 1280), height: 900 } });
const page = await ctx.newPage();
const text = () => page.evaluate(() => document.body.innerText);
try {
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => {
    localStorage.setItem('has-session', '1');
    localStorage.setItem('floral_cached_user', JSON.stringify({ id: 'b'.repeat(24), name: 'Dr. Maria Santos', email: 'd@f.com', role: 'dentist', schools: ['Bagong Tanyag Integrated School'] }));
    localStorage.setItem('queued-student-ids', JSON.stringify([window.__x = 'd'.repeat(24), 'e'.repeat(24)]));
  });
  await page.goto(`http://localhost:5173/dental-chart/${sid}?tab=history`); await page.waitForTimeout(3000);
  await page.goto('http://localhost:5173/dental-charts'); await page.waitForTimeout(2500); // caches both students' rows
  await page.evaluate(async (s2) => { const { apiClient } = await import('/src/app/api/client.ts'); await apiClient.get(`/students/${s2}`); }, sid2);
  await ctx.setOffline(true); await page.waitForTimeout(600);
  await page.evaluate(async ({ chart, sid }) => {
    const { apiClient } = await import('/src/app/api/client.ts');
    await apiClient.put(`/dental-charts/${chart}`, { dmf_index: 1 });
    await new Promise((r) => setTimeout(r, 20));
    await apiClient.put(`/dental-charts/${chart}`, { dmf_index: 2 });
    await apiClient.put(`/students/${sid}`, { contact_number: '0555' });
    await apiClient.post('/treatments', { iptr_id: '1'.repeat(24), treatment_done: 'Filling' });
  }, { chart, sid });
  await ctx.setOffline(false);
  await page.waitForSelector('dialog[open]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const t = await text();
  check('the same field edited twice offline did not clash with itself: server holds the latest value', state.chart.dmf_index === 2, `dmf_index=${state.chart.dmf_index}`);
  check('the report opens by itself and names the student', /Sync report/.test(t) && /Andaya, Xian Rex/.test(t), t.slice(0, 300));
  check('the genuine clash is shown as needing attention', /Needs attention/.test(t) && /Held for your review/.test(t));
  check('the repeatedly edited field shows three versions', /Edited 2 times offline/.test(t) && /Original/.test(t) && /Edit 1/.test(t) && /Latest/.test(t));
  check('a queued student with nothing to sync is listed as No changes', /Uy, Gabriel/.test(t) && /Nothing was changed for this student/.test(t));
  await page.screenshot({ path: process.env.SHOT || 'sync-report-check.png' });
  // Keep Edit 1: sent as a new edit, server value becomes 1.
  await page.getByRole('button', { name: /Edit 1/ }).click();
  await page.waitForTimeout(1500);
  check('keeping an earlier version sends it as a new edit', state.chart.dmf_index === 1, `dmf_index=${state.chart.dmf_index}`);
  const t2 = await text();
  check('the kept version is marked Kept', /Kept/.test(t2));
} catch (e) { check('script ran to the end', false, e.message); }
finally { await browser.close(); srv.kill(); api.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
