// Sprint 110 — do the report numbers update themselves while someone watches?
//
// The claim being tested is specific: an open report picks up a change made by
// SOMEONE ELSE, without the viewer touching anything, and does so by actually
// re-reading the database rather than ticking a clock.
import fs from 'node:fs';
import { chromium } from 'playwright';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const results = [];
const check = (n, pass, detail) => results.push({ check: n, result: pass ? 'PASS' : 'FAIL', detail });

// --- an API session standing in for "another member of staff"
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'dentist@floral.com', password: env.SEED_DENTIST_PASSWORD }),
});
const cookie = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
const api = async (path, method = 'GET', body) => {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// --- the token endpoint itself
const t1 = await api('/stats/last-change');
check('/stats/last-change responds', t1.status === 200 && 'at' in (t1.body ?? {}), JSON.stringify(t1.body));

// --- and it MOVES when something is written
const note = await api('/day-notes', 'POST', { date: '2096-06-06', school_id: null, note: 'sprint110 token probe' });
const t2 = await api('/stats/last-change');
check('the token advances after a write', t2.body?.at && t2.body.at !== t1.body?.at, `${t1.body?.at} -> ${t2.body?.at}`);

// --- now the real question, in a browser
const browser = await chromium.launch();
const page = await browser.newPage();
let pollCount = 0;
let reportFetches = 0;
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/stats/last-change')) pollCount++;
  else if (u.includes('/api/student-iptrs') || u.includes('/api/oral-health-conditions')) reportFetches++;
});

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', 'dentist@floral.com');
await page.fill('input[type="password"]', env.SEED_DENTIST_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
if (page.url().includes('/select-school')) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /School/i.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
}
check('reports screen loaded (not the school gate)', !page.url().includes('/select-school'), page.url().replace(BASE, ''));

const stamp = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((s) => /^Updated \d/.test(s.textContent?.trim() ?? ''));
  return el ? el.textContent.trim() : null;
});
check('no "Updated" stamp before any self-refresh', (await stamp()) === null, `${await stamp()}`);

// Settle, then let it poll quietly with NOTHING changing.
reportFetches = 0;
pollCount = 0;
await page.waitForTimeout(25000);
const idlePolls = pollCount;
const idleFetches = reportFetches;
check('it polls while idle', idlePolls > 0, `${idlePolls} poll(s) in 25s`);
check('an idle poll does NOT refetch the report', idleFetches === 0, `${idleFetches} report fetch(es)`);

// --- someone else writes. The open page must notice on its own.
await api('/day-notes', 'POST', { date: '2096-06-06', school_id: null, note: 'sprint110 change ' + Date.now() });
reportFetches = 0;
await page.waitForTimeout(28000);
check('an outside change triggers a real refetch', reportFetches > 0, `${reportFetches} report fetch(es)`);
const shown = await stamp();
check('"Updated HH:MM" appears after the refresh', !!shown, shown ?? '(none)');

await browser.close();

// --- cleanup: archive the probe notes, never hard delete
for (const n of ((await api('/day-notes?from=2096-06-01&to=2096-06-30')).body ?? [])) {
  await api(`/day-notes/${n._id}/archive`, 'PATCH');
}
const left = ((await api('/day-notes?from=2096-06-01&to=2096-06-30')).body ?? []);
check('cleanup — probe notes archived', left.length === 0, `${left.length} left`);

console.table(results);
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
