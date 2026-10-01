// Sprint 101 — does the school gate hold on the SERVER?
//
// Before this sprint every account received all three schools' data no matter
// what it was assigned. The probe that found it is reproduced here as a
// regression test: schooladmin is pinned to Annex A and must see only Annex A;
// unscoped accounts must be unaffected.
//
//   node verify_sprint101.mjs                 (against production)
//   BASE_URL=http://localhost:3000 node ...   (against local dev)
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const login = async (email, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};
const get = async (cookie, path) => {
  const r = await fetch(BASE + '/api' + path, { headers: { cookie } });
  return { status: r.status, body: r.ok ? await r.json() : null };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail });
};

// --- unscoped baseline: the admin sees everything, and is the source of truth
const admin = await login('admin@floral.com', env.SEED_ADMIN_PASSWORD);
const allRows = (await get(admin, '/stats/student-rows')).body;
const allSchools = [...new Set(allRows.map((s) => s.school))];
const allStudents = (await get(admin, '/students')).body;
console.log(`baseline: ${allRows.length} students across ${allSchools.length} schools\n`);

// --- the scoped account
const sa = await login('schooladmin@floral.com', env.SEED_SCHOOLADMIN_PASSWORD);

const saRows = (await get(sa, '/stats/student-rows')).body;
const saSchools = [...new Set(saRows.map((s) => s.school))];
check('stats/student-rows is scoped', saSchools.length === 1 && saRows.length < allRows.length,
  `${saRows.length}/${allRows.length} students, schools: ${saSchools.join(', ') || 'none'}`);

const saStudents = (await get(sa, '/students')).body;
check('GET /students is scoped', saStudents.length === saRows.length && saStudents.length < allStudents.length,
  `${saStudents.length}/${allStudents.length}`);

// --- child collections must follow the chain, not just the top level
const saIptrs = (await get(sa, '/student-iptrs')).body;
const allIptrs = (await get(admin, '/student-iptrs')).body;
check('GET /student-iptrs is scoped (via student_id)', saIptrs.length < allIptrs.length,
  `${saIptrs.length}/${allIptrs.length}`);

const saTeeth = (await get(sa, '/tooth-records')).body;
const allTeeth = (await get(admin, '/tooth-records')).body;
check('GET /tooth-records is scoped (chart -> iptr -> student, 3 levels)', saTeeth.length < allTeeth.length,
  `${saTeeth.length}/${allTeeth.length}`);

const saRisk = (await get(sa, '/risk-stratifications')).body;
const allRisk = (await get(admin, '/risk-stratifications')).body;
check('GET /risk-stratifications is scoped (preventive -> iptr -> student)', saRisk.length <= allRisk.length,
  `${saRisk.length}/${allRisk.length}`);

// --- the direct-id path: naming another school's student must not reveal it
const outsider = allRows.find((s) => !saSchools.includes(s.school));
if (outsider) {
  const direct = await get(sa, `/students/${outsider.id}`);
  check('GET /students/:id on another school returns 404', direct.status === 404,
    `HTTP ${direct.status} for a ${outsider.school} student`);

  const own = saRows[0] && (await get(sa, `/students/${saRows[0].id}`));
  check('GET /students/:id on own school still works', own && own.status === 200, `HTTP ${own?.status}`);
} else {
  check('outsider student available for the direct-id test', false, 'none found');
}

// --- the client cannot widen its own scope with a query param
const widened = (await get(sa, `/stats/high-risk-count?school=${encodeURIComponent(allSchools.find((s) => !saSchools.includes(s)) ?? '')}`)).body;
check('?school pointing outside the account cannot widen', widened && widened.count === 0,
  `count ${widened?.count}`);

// --- the bug the first run caught: a parent filter must SURVIVE the scope
// clause. Spreading them let the scope overwrite `iptr_id`, so one pupil's
// request returned every in-scope pupil's records.
const ownStudent = saRows[0];
const ownIptrs = (await get(sa, `/student-iptrs?student_id=${ownStudent.id}`)).body;
check('a parent filter is not swallowed by the scope clause', ownIptrs.length > 0 && ownIptrs.length < saIptrs.length,
  `${ownIptrs.length} iptrs for one pupil vs ${saIptrs.length} in scope`);
if (ownIptrs.length) {
  const oneIptr = (await get(sa, `/medical-histories?iptr_id=${ownIptrs[0]._id}`)).body;
  const allMine = (await get(sa, '/medical-histories')).body;
  check('medical-histories honours iptr_id AND scope', oneIptr.length <= allMine.length && oneIptr.every((m) => m.iptr_id === ownIptrs[0]._id),
    `${oneIptr.length} for one iptr, ${allMine.length} in scope`);
}

// --- unscoped roles must be untouched by all of this
for (const [email, key] of [['dentist@floral.com', 'SEED_DENTIST_PASSWORD'], ['bho@floral.com', 'SEED_BHO_PASSWORD']]) {
  const c = await login(email, env[key]);
  const rows = (await get(c, '/stats/student-rows')).body;
  check(`${email.split('@')[0]} (unscoped) still sees every school`, rows.length === allRows.length,
    `${rows.length}/${allRows.length}`);
}

console.table(results);
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
