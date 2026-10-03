// Sprint 70 — the IPTR's grade and section are editable.
//
// From the dentist's handwritten notes, where "IPTR must be editable" appears
// twice, with the case that motivates it: "paano pag naretain ang student?" —
// a retained pupil repeats a grade, so the year record has to be correctable.
//
// Sprint 57a put grade/section on the IPTR but only ever WROTE them at
// creation (Add Year, or Sprint 69's student intake). Nothing could fix a
// mistake, and nothing could record a retention.
//
// Two grades now exist on purpose and the test asserts they stay independent:
// STUDENT carries current enrolment (rosters, the appointment picker), each
// IPTR carries the grade that pupil was actually in that year.
//
// Usage: node verify_sprint70.mjs [apiBase]
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
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  console.log(`\nSprint 70 verification against ${API}\n`);

  const iptrs = (await api('/student-iptrs')).body;
  const students = (await api('/students')).body;
  const studentById = new Map(students.map((s) => [s._id, s]));

  const target = iptrs.find((i) => i.grade_level);
  const student = studentById.get(target.student_id);
  const before = { grade: target.grade_level, section: target.section };
  const studentBefore = { grade: student.grade_level, section: student.section };
  console.log(`  ${student.last_name}: student is ${studentBefore.grade}, ${target.school_year} record is ${before.grade}`);

  // The retention case: the year record says a DIFFERENT grade from the
  // student's current one. Before this sprint that could not be expressed.
  // Pick a grade the student is NOT currently in, so "they can differ" is a
  // real assertion rather than a coincidence.
  const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
  const differentGrade = GRADES.find((g) => g !== studentBefore.grade && g !== before.grade);
  const retained = await api(`/student-iptrs/${target._id}`, {
    method: 'PUT', body: JSON.stringify({ grade_level: differentGrade, section: 'Retained-Test' }),
  });
  check('the year record accepts a grade edit', retained.status === 200, `got ${retained.status}`);
  check('the edit persisted on the year record',
    retained.body.grade_level === differentGrade && retained.body.section === 'Retained-Test',
    JSON.stringify({ g: retained.body?.grade_level, s: retained.body?.section }));

  // The critical independence assertion.
  const studentAfter = (await api(`/students/${student._id}`)).body;
  check('editing the YEAR does not change the student\'s current enrolment',
    studentAfter.grade_level === studentBefore.grade && studentAfter.section === studentBefore.section,
    JSON.stringify({ was: studentBefore, now: { grade: studentAfter.grade_level, section: studentAfter.section } }));
  check('the two can genuinely differ (a retained pupil is expressible)',
    retained.body.grade_level !== studentAfter.grade_level,
    `${retained.body.grade_level} vs ${studentAfter.grade_level}`);

  // Other years of the same pupil are untouched.
  const siblings = iptrs.filter((i) => i.student_id === target.student_id && i._id !== target._id);
  if (siblings.length) {
    const after = (await api('/student-iptrs')).body;
    const others = after.filter((i) => siblings.some((sb) => sb._id === i._id));
    check('other school years are unaffected',
      others.every((o, n) => o.grade_level === siblings[n].grade_level),
      JSON.stringify(others.map((o) => o.grade_level)));
  }

  // Clearing goes back to "not recorded", not an empty string — the UI reads
  // null as "not recorded" and "" would render as a blank that looks recorded.
  const cleared = await api(`/student-iptrs/${target._id}`, {
    method: 'PUT', body: JSON.stringify({ grade_level: null, section: null }),
  });
  check('clearing stores null, not an empty string',
    cleared.body.grade_level === null && cleared.body.section === null,
    JSON.stringify({ g: cleared.body?.grade_level, s: cleared.body?.section }));

  // Restore.
  const restored = await api(`/student-iptrs/${target._id}`, {
    method: 'PUT', body: JSON.stringify({ grade_level: before.grade, section: before.section }),
  });
  check('cleanup restored the original values',
    restored.body.grade_level === before.grade && restored.body.section === before.section);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
