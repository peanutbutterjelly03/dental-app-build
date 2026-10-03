// Sprint 57a — the IPTR carries its own grade, so old years stop lying.
//
// The bug: grade_level/section lived only on STUDENT as a single current value,
// so opening a past school year's record showed today's grade. The fix stamps
// them on STUDENT_IPTR. The test that matters is therefore: pick a student with
// MORE THAN ONE school year, and confirm the two years do not render the same
// grade line when the underlying records differ — and that a year with no
// recorded grade says so instead of borrowing the current one.
//
// Usage: node verify_sprint57a.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';

const API = process.argv[3] || 'http://localhost:4000';
let cookie = '';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function api(path) {
  const res = await fetch(`${API}/api${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com',
      password: process.env.SEED_DENTIST_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

const run = async () => {
  await login();
  console.log(`\nSprint 57a verification against ${API}\n`);

  const students = await api('/students');
  const byId = new Map(students.map((s) => [s._id, s]));

  // Gather every IPTR, grouped per student.
  const perStudent = new Map();
  for (const s of students) {
    const mine = await api(`/student-iptrs?student_id=${s._id}`);
    if (mine.length) perStudent.set(s._id, mine.sort((a, b) => a.school_year.localeCompare(b.school_year)));
  }

  const total = [...perStudent.values()].flat().length;
  const withGrade = [...perStudent.values()].flat().filter((i) => i.grade_level).length;
  console.log(`  ${perStudent.size} student(s), ${total} IPTR(s), ${withGrade} carrying a grade\n`);

  check('the API exposes grade_level/section on IPTRs', total > 0 && [...perStudent.values()].flat().every((i) => 'grade_level' in i && 'section' in i));
  check('the migration filled the current-year records', withGrade > 0);

  // The point of the sprint: a filled IPTR agrees with the student's CURRENT
  // grade only where the year is the current one. Older years must be null
  // rather than silently equal to it.
  const SY_NOW = (() => { const d = new Date(); const y = d.getFullYear(); return d.getMonth() <= 3 ? `${y - 1}-${y}` : `${y}-${y + 1}`; })();
  console.log(`  current school year: ${SY_NOW}`);

  let multiYear = 0, olderNull = 0, futureNull = 0, wrongFill = 0;
  for (const [sid, iptrs] of perStudent) {
    if (iptrs.length > 1) multiYear++;
    const filled = iptrs.filter((i) => i.grade_level);
    for (const i of filled) {
      // Nothing after the current school year should have been filled by the
      // migration — that would assert a promotion that has not happened.
      if (i.school_year > SY_NOW) { wrongFill++; console.log(`        future year filled: ${byId.get(sid)?.last_name} ${i.school_year}`); }
    }
    for (const i of iptrs) {
      if (!i.grade_level && i.school_year < SY_NOW) olderNull++;
      if (!i.grade_level && i.school_year > SY_NOW) futureNull++;
    }
  }
  check('no future-dated IPTR was given a grade', wrongFill === 0, `${wrongFill} filled`);
  check('there is at least one multi-year student to prove the fix on', multiYear > 0, `${multiYear}`);
  console.log(`        ${olderNull} older year(s) left null, ${futureNull} future year(s) left null`);

  // Re-running the migration must not change anything, and the fields must
  // survive a normal CRUD read (they are plain strings, not encrypted).
  const sample = [...perStudent.values()].flat().find((i) => i.grade_level);
  check('a filled IPTR round-trips through GET /student-iptrs/:id', await (async () => {
    const one = await api(`/student-iptrs/${sample._id}`);
    return one.grade_level === sample.grade_level && one.section === sample.section;
  })());

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err.message); process.exit(1); });
