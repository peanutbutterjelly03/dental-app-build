// Existing records must stay visible offline (real service worker, production build).
// Regression guard for: "when offline, records made online start to vanish".
// NOTE: `npm run dev` has NO service worker, so offline testing there cannot
// work by design — test against a build:  npm run build && node verify_offline_list.mjs
// Usage: CHROMIUM_PATH=... only where Playwright's own browser is missing.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const mode = 'preview';
const URL_ = 'http://localhost:4173';
const row = (n, last, first) => ({ id: String(n).repeat(24).slice(0,24), name: `${last}, ${first}`, lastName: last, firstName: first, middleName: '', birthdate: '2015-01-01', gender: 'Male', grade: 'Grade 3', section: 'A', school: 'Bagong Tanyag Integrated School', lastVisit: null, oralStatus: 'Not Yet Screened', riskLevel: null, recommendation: '', pipelineStatus: 'For Oral Exam', consentStatus: 'pending' });
const school = { _id: 'a'.repeat(24), school_name: 'Bagong Tanyag Integrated School', isArchived: false };
const user = { _id: 'b'.repeat(24), school_ids: [], role: 'dentist', full_name: 'Dr Test', email: 'd@floral.com', is_enrolled: true, last_login: null, isArchived: false };
const hits = [];
const api = http.createServer((req, res) => {
  const p = req.url.split('?')[0]; hits.push(req.method + ' ' + p);
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/api/auth/me') return send(200, user);
  if (p === '/api/schools') return send(200, [school]);
  if (p === '/api/stats/student-rows') return send(200, [row(1,'Cruz','Juan'), row(2,'Reyes','Maria'), row(3,'Santos','Pedro')]);
  if (p === '/api/config') return send(200, {});
  if (p === '/api/stats/rpc-rows') return send(200, { rows: [], total: 0, limit: 1000, offset: 0 });
  send(200, p.startsWith('/api/stats/') ? {} : []);
});
await new Promise(r => api.listen(4000, r));
const srv = spawn('npx', ['vite','preview','--port','4173','--strictPort'], { stdio: 'ignore' });
for (let i=0;i<60;i++){ try{ if((await fetch(URL_)).ok) break;}catch{} await new Promise(r=>setTimeout(r,500)); }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  pageerror:', e.message.slice(0,120)));
const names = async () => page.evaluate(() => ['Cruz','Reyes','Santos'].filter(n => document.body.innerText.includes(n)));
await page.goto(URL_ + '/');
await page.evaluate(() => { localStorage.setItem('has-session','1'); localStorage.setItem('floral_cached_user', JSON.stringify({id:'b'.repeat(24),name:'Dr Test',email:'d@floral.com',role:'dentist',schools:['Bagong Tanyag Integrated School']})); });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.goto(URL_ + '/patients'); await page.waitForTimeout(3000);
let pass = 0, fail = 0; const check = (n, ok, x='') => { ok ? pass++ : fail++; console.log((ok?'PASS':'FAIL')+'  '+n+(ok?'':'  '+x)); }; const all3 = (a) => a.length === 3;
check('online: the 3 records are listed', all3(await names()), JSON.stringify(await names()));
await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller); await page.waitForTimeout(1500);
await ctx.setOffline(true);
await page.waitForTimeout(500);
// A: SPA navigation away and back
await page.evaluate(() => { history.pushState({}, '', '/notifications'); window.dispatchEvent(new PopStateEvent('popstate')); }); await page.waitForTimeout(800);
await page.evaluate(() => { history.pushState({}, '', '/patients'); window.dispatchEvent(new PopStateEvent('popstate')); }); await page.waitForTimeout(2500);
check('offline, after leaving the page and coming back: records still listed', all3(await names()), JSON.stringify(await names()));
// B: hard reload while offline
await page.reload().catch(e => console.log('  reload failed:', e.message.slice(0,80))); await page.waitForTimeout(3500);
check('offline, after a full page reload: records still listed', all3(await names()), JSON.stringify(await names()) + ' ' + page.url());
await b.close(); srv.kill(); api.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
