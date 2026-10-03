// Sprint 76 — archiving must not permanently block re-creation.
//
// The create guard used to count archived records, which made archiving worse
// than deleting: an IPTR recorded against the wrong pupil and archived left
// that pupil+year permanently uncreatable, 409-ing against a record the UI
// cannot even show. The uniqueness check now lives on restore instead.
//
// Both halves have to hold, or the fix just trades one bug for the other:
//   1. an archived record does NOT block creating a new one
//   2. restoring is REFUSED while a live record holds the same key
//
// Cleans up everything it creates. Usage: node verify_sprint76.mjs [apiBase]
import 'dotenv/config';

const API = process.argv[2] || 'http://localhost:4000';
let cookie = '';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
async function api(path, init = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const run = async () => {
  // Admin: needed for archive AND restore on this model.
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL || 'admin@floral.com', password: process.env.SEED_ADMIN_PASSWORD }),
  });
  if (!login.ok) { console.error(`login failed: ${login.status}`); process.exit(1); }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  // A far-future year nothing else uses, so this test cannot collide with real
  // data or with verify_sprint74's 2027-2028 rows.
  const YEAR = '2098-2099';
  console.log(`\nSprint 76 verification against ${API}  (test year ${YEAR})\n`);

  const students = (await api('/students')).body;
  const student_id = students?.[0]?._id;
  if (!student_id) { console.error('no students to test with'); process.exit(1); }

  const created = [];
  const mk = (grade) => api('/student-iptrs', {
    method: 'POST', body: JSON.stringify({ student_id, school_year: YEAR, grade_level: grade, section: 'T' }),
  });

  // ── 1. a live record blocks a second one (unchanged behaviour) ───────────
  const first = await mk('Grade 1');
  check('a first record is created', first.status === 201, `got ${first.status}`);
  if (first.status === 201) created.push(first.body._id);

  const dup = await mk('Grade 2');
  check('a LIVE record still blocks a duplicate (409)', dup.status === 409, `got ${dup.status}`);
  if (dup.status === 201) created.push(dup.body._id);

  // ── 2. archived must NOT block — the bug ────────────────────────────────
  const arch = await api(`/student-iptrs/${first.body._id}/archive`, { method: 'PATCH' });
  check('the record archives', arch.status === 200, `got ${arch.status}`);

  const second = await mk('Grade 2');
  check('an ARCHIVED record does NOT block creating a new one', second.status === 201, `got ${second.status}`);
  if (second.status === 201) created.push(second.body._id);

  // ── 3. restore is refused while the live one holds the key ──────────────
  const restore = await api(`/student-iptrs/${first.body._id}/restore`, { method: 'PATCH' });
  check('restoring is REFUSED while a live record holds the key (409)', restore.status === 409, `got ${restore.status}`);
  check('the refusal says what to do about it',
    typeof restore.body?.error === 'string' && restore.body.error.includes('Archive that one first'),
    JSON.stringify(restore.body));

  // ── 4. once the clash is archived, restore works ────────────────────────
  await api(`/student-iptrs/${second.body._id}/archive`, { method: 'PATCH' });
  const restore2 = await api(`/student-iptrs/${first.body._id}/restore`, { method: 'PATCH' });
  check('restore succeeds once the clashing record is archived', restore2.status === 200, `got ${restore2.status}`);

  // ── cleanup: archive everything created (never hard delete) ─────────────
  for (const id of created) await api(`/student-iptrs/${id}/archive`, { method: 'PATCH' });
  const leftover = ((await api('/student-iptrs')).body ?? []).filter((i) => i.school_year === YEAR);
  check('cleanup left no live test records behind', leftover.length === 0, `${leftover.length} left`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
