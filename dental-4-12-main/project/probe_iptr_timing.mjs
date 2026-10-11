import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';
let cookie = '';

const t = async (label, path) => {
  const s = Date.now();
  const r = await fetch(BASE + '/api' + path, { headers: { cookie } });
  const b = await r.json().catch(() => null);
  return { label, ms: Date.now() - s, status: r.status, rows: Array.isArray(b) ? b.length : 1 };
};

const s0 = Date.now();
const lr = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'dentist@floral.com', password: env.SEED_DENTIST_PASSWORD }),
});
cookie = (lr.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
console.log('login', lr.status, Date.now() - s0 + 'ms');
if (!lr.ok) { console.log(await lr.text()); process.exit(1); }

const sRows = Date.now();
const rows = await (await fetch(BASE + '/api/stats/student-rows', { headers: { cookie } })).json();
console.log('stats/student-rows', Date.now() - sRows + 'ms,', rows.length, 'students');

const id = rows[0]._id || rows[0].id;

const T0 = Date.now();
const w1 = await Promise.all([
  t('student', `/students/${id}`),
  t('schools', '/schools'),
  t('iptrs', `/student-iptrs?student_id=${id}`),
  t('dentists', '/dentists'),
]);
const w1ms = Date.now() - T0;

const iptrs = await (await fetch(BASE + `/api/student-iptrs?student_id=${id}`, { headers: { cookie } })).json();
const q = iptrs.map((i) => i._id).join(',');

const T1 = Date.now();
const w2 = await Promise.all([
  t('medical', `/medical-histories?iptr_id=${q}`),
  t('diet', `/dietary-social-habits?iptr_id=${q}`),
  t('oral', `/oral-health-conditions?iptr_id=${q}`),
  t('charts', `/dental-charts?iptr_id=${q}`),
  t('treatments', `/treatments?iptr_id=${q}`),
]);
const w2ms = Date.now() - T1;

const charts = await (await fetch(BASE + `/api/dental-charts?iptr_id=${q}`, { headers: { cookie } })).json();

const T2 = Date.now();
const w3 = await t('tooth-records', `/tooth-records?chart_id=${charts.map((c) => c._id).join(',')}`);
const w3ms = Date.now() - T2;

console.table([...w1, ...w2, w3]);
console.log('WAVE1', w1ms, '| WAVE2', w2ms, '| WAVE3', w3ms, '| TOTAL', w1ms + w2ms + w3ms, 'ms');
