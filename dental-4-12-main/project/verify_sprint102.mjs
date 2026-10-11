// Sprint 102 — is Promote/Assign re-runnable?
//
// Exercises the API path the screen uses, twice over the same pupil:
//   run 1  POST /student-iptrs           -> creates the target year
//   run 2  POST again                    -> MUST 409 (this is why the screen
//                                           used to be unable to fix itself)
//   run 2' PUT /student-iptrs/:id        -> MUST correct in place
// Then it puts the record back exactly as it was.
//
//   node verify_sprint102.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const lr = await fetch(BASE + '/api/auth/login', {
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

const results = [];
const check = (name, pass, detail) => results.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail });

// A throwaway school year far from any real one, so nothing real is disturbed.
const YEAR = '2098-2099';
const rows = (await api('/stats/student-rows')).body;
const student = rows[0];
console.log(`using ${student.name}, throwaway year ${YEAR}\n`);

// Clean slate in case a previous run left one behind.
const pre = (await api(`/student-iptrs?student_id=${student.id}`)).body.filter((i) => i.school_year === YEAR);
for (const p of pre) await api(`/student-iptrs/${p._id}/archive`, 'PATCH');

// --- run 1: create
const first = await api('/student-iptrs', 'POST', {
  student_id: student.id, school_year: YEAR, grade_level: 'Grade 4', section: 'Sampaguita',
});
check('run 1 creates the target year', first.status === 201, `HTTP ${first.status}`);
const iptrId = first.body?._id;

// --- run 2 the OLD way: a second POST must still be refused
const second = await api('/student-iptrs', 'POST', {
  student_id: student.id, school_year: YEAR, grade_level: 'Grade 4', section: 'Rosal',
});
check('a duplicate POST is still refused (409)', second.status === 409,
  `HTTP ${second.status} — this is why the screen could not fix itself`);

// --- run 2 the NEW way: correct in place
const corrected = await api(`/student-iptrs/${iptrId}`, 'PUT', { grade_level: 'Grade 4', section: 'Rosal' });
check('PUT corrects the existing record', corrected.status === 200 && corrected.body?.section === 'Rosal',
  `HTTP ${corrected.status}, section now ${corrected.body?.section}`);

// --- and it must have CORRECTED, not created a second row
const after = (await api(`/student-iptrs?student_id=${student.id}`)).body.filter((i) => i.school_year === YEAR);
check('still exactly one record for that year', after.length === 1, `${after.length} record(s)`);
check('the correction stuck', after[0]?.section === 'Rosal' && after[0]?.grade_level === 'Grade 4',
  `${after[0]?.grade_level} · ${after[0]?.section}`);

// --- cleanup: archive the throwaway year (never hard delete)
const cleaned = await api(`/student-iptrs/${iptrId}/archive`, 'PATCH');
check('throwaway record archived, not deleted', cleaned.status === 200, `HTTP ${cleaned.status}`);
const left = (await api(`/student-iptrs?student_id=${student.id}`)).body.filter((i) => i.school_year === YEAR);
check('nothing left behind in live data', left.length === 0, `${left.length} live record(s) for ${YEAR}`);

console.table(results);
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
