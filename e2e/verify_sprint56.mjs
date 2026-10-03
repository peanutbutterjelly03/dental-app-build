// Sprint 56 — correctness check for the bounded appointment reads.
//
// Verifies the new crudFactory query options against a real server + database:
// the date bound on /appointments, the _id and text filters on /students, and
// that every invalid input is rejected rather than passed through to the query.
//
// Reads credentials from .env like every other verify_* script — never hardcode.
// Usage: node verify_sprint56.mjs [baseUrl]   (default http://localhost:3001)
import 'dotenv/config';

const BASE = process.argv[2] || 'http://localhost:3001';
let cookie = '';
let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(path) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { cookie } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login() {
  const email = process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com';
  const password = process.env.SEED_DENTIST_PASSWORD;
  if (!password) throw new Error('SEED_DENTIST_PASSWORD not set in .env');
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no cookies');
}

const run = async () => {
  await login();
  console.log(`\nSprint 56 verification against ${BASE}\n`);

  // --- Baseline -----------------------------------------------------------
  const all = await api('/appointments');
  check('GET /appointments (unbounded) still works', all.status === 200 && Array.isArray(all.body));
  const total = all.body.length;
  console.log(`        ${total} appointments, ${new Set(all.body.map((a) => a.student_id)).size} distinct students referenced`);

  // --- Date bound ---------------------------------------------------------
  const dates = all.body.map((a) => new Date(a.appointment_datetime)).sort((a, b) => a - b);
  if (dates.length === 0) {
    console.log('  SKIP  date-bound checks — no appointments in the database');
  } else {
    const earliest = dates[0];
    const latest = dates[dates.length - 1];

    const wide = await api(`/appointments?from=${new Date(earliest.getTime() - 86400000).toISOString()}&to=${new Date(latest.getTime() + 86400000).toISOString()}`);
    check('a window spanning every appointment returns them all', wide.status === 200 && wide.body.length === total, `got ${wide.body?.length} of ${total}`);

    const before = await api(`/appointments?to=${new Date(earliest.getTime() - 1).toISOString()}`);
    check('a window ending before the earliest returns none', before.status === 200 && before.body.length === 0, `got ${before.body?.length}`);

    const after = await api(`/appointments?from=${new Date(latest.getTime() + 1).toISOString()}`);
    check('a window starting after the latest returns none', after.status === 200 && after.body.length === 0, `got ${after.body?.length}`);

    // Bounds are inclusive, so asking for exactly one instant must return it.
    const exact = await api(`/appointments?from=${earliest.toISOString()}&to=${earliest.toISOString()}`);
    const expected = dates.filter((d) => d.getTime() === earliest.getTime()).length;
    check('both bounds are inclusive', exact.status === 200 && exact.body.length === expected, `got ${exact.body?.length}, expected ${expected}`);

    const half = await api(`/appointments?from=${latest.toISOString()}`);
    check('a from-only bound filters without needing a to', half.status === 200 && half.body.every((a) => new Date(a.appointment_datetime) >= latest));
  }

  check('an unparseable date is rejected', (await api('/appointments?from=notadate')).status === 400);
  check('a repeated param (array, not string) is rejected', (await api('/appointments?from=2020-01-01&from=2021-01-01')).status === 400);

  // --- Student _id filter + chunking --------------------------------------
  const students = await api('/students');
  check('GET /students still works', students.status === 200 && Array.isArray(students.body));
  const ids = students.body.map((s) => s._id);
  console.log(`        ${ids.length} students in the database`);

  if (ids.length >= 2) {
    const two = await api(`/students?_id=${ids[0]},${ids[1]}`);
    check('_id filter returns exactly the requested students', two.status === 200 && two.body.length === 2 && two.body.every((s) => [ids[0], ids[1]].includes(s._id)), `got ${two.body?.length}`);
    check('_id-filtered students still decrypt (names are readable)', two.body.every((s) => typeof s.last_name === 'string' && s.last_name.length > 0 && !s.last_name.includes(':')));
  }
  check('a non-ObjectId _id is rejected', (await api('/students?_id=notanid')).status === 400);
  check('an over-cap id list is rejected (unbounded $in guard holds)', (await api(`/students?_id=${Array(201).fill('507f1f77bcf86cd799439011').join(',')}`)).status === 400);
  check('an at-cap id list is accepted', (await api(`/students?_id=${Array(200).fill('507f1f77bcf86cd799439011').join(',')}`)).status === 200);

  // --- Student text filter -------------------------------------------------
  if (students.body.length > 0) {
    const sample = students.body[0];
    const roster = await api(`/students?school_id=${sample.school_id}&grade_level=${encodeURIComponent(sample.grade_level)}`);
    const expected = students.body.filter((s) => s.school_id === sample.school_id && s.grade_level === sample.grade_level).length;
    check('school_id + grade_level filter matches a client-side filter', roster.status === 200 && roster.body.length === expected, `got ${roster.body?.length}, expected ${expected}`);
    check('the grade filter actually constrains', roster.body.every((s) => s.grade_level === sample.grade_level));

    const withSection = await api(`/students?school_id=${sample.school_id}&grade_level=${encodeURIComponent(sample.grade_level)}&section=${encodeURIComponent(sample.section)}`);
    check('section narrows further', withSection.status === 200 && withSection.body.every((s) => s.section === sample.section) && withSection.body.length <= roster.body.length);
  }
  check('an over-long text filter is rejected', (await api(`/students?grade_level=${'x'.repeat(101)}`)).status === 400);
  check('an empty text filter is rejected', (await api('/students?grade_level=')).status === 400);
  check('a non-whitelisted field is ignored, not queried', (await api('/students?sex=Male')).body?.length === ids.length);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
