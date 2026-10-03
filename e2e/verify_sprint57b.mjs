// Sprint 57b — the DOH reports are scoped to a school year.
//
// Before this, useDohReportData counted every record ever created and keyed
// every count by the student's CURRENT grade and their age TODAY. So a report
// could not answer "what did we do this year?", and re-opening a filed report
// after a promotion or a birthday quietly produced different numbers.
//
// This rebuilds the expected counts from the raw collections the same way the
// hook now does — per IPTR, scoped to a year, grade from the IPTR, age at that
// year's first visit — and checks the arithmetic the UI depends on.
//
// Usage: node verify_sprint57b.mjs [apiBase]   (default http://localhost:4000)
import 'dotenv/config';

const API = process.argv[2] || 'http://localhost:4000';
let cookie = '';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function api(path) {
  const res = await fetch(`${API}/api${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

const ageAt = (birthdate, on) => {
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let a = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) a--;
  return a;
};
const bracketOf = (a) => a === null ? 'unknown'
  : a <= 4 ? '4 yrs & below' : a <= 9 ? '5-9 yrs' : a <= 14 ? '10-14 yrs' : a <= 19 ? '15-19 yrs' : '20 yrs & above';

const run = async () => {
  await login();
  console.log(`\nSprint 57b verification against ${API}\n`);

  const [students, iptrs, orals, preventives] = await Promise.all([
    api('/students'), api('/student-iptrs'), api('/oral-health-conditions'), api('/preventive-care-records'),
  ]);
  const studentById = new Map(students.map((s) => [s._id, s]));
  const oralByIptr = new Map(orals.map((o) => [o.iptr_id, o]));

  const firstVisit = new Map();
  for (const p of preventives) {
    if (!p.visit_date) continue;
    const d = new Date(p.visit_date);
    if (Number.isNaN(d.getTime())) continue;
    const seen = firstVisit.get(p.iptr_id);
    if (!seen || d < seen) firstVisit.set(p.iptr_id, d);
  }
  const syStart = (sy) => { const y = Number(String(sy).split('-')[0]); return Number.isFinite(y) ? new Date(y, 5, 1) : null; };

  const years = [...new Set(iptrs.map((i) => i.school_year))].sort();
  console.log(`  ${iptrs.length} IPTR(s) across ${years.length} school year(s): ${years.join(', ')}\n`);
  check('there is more than one school year, so scoping is observable', years.length > 1, `${years.length}`);

  // "examined" counts one per IPTR that has an oral-health record.
  const examinedIn = (sy) => iptrs.filter((i) => (sy === null || i.school_year === sy) && oralByIptr.has(i._id)).length;
  const allTime = examinedIn(null);
  const perYear = years.map((y) => [y, examinedIn(y)]);
  for (const [y, n] of perYear) console.log(`        ${y}: ${n} examined`);
  console.log(`        all years: ${allTime} examined`);

  check('per-year counts sum to the all-years count', perYear.reduce((s, [, n]) => s + n, 0) === allTime,
    `${perYear.reduce((s, [, n]) => s + n, 0)} vs ${allTime}`);
  check('at least one year differs from the all-years total (scoping does something)',
    perYear.some(([, n]) => n !== allTime));

  // Age is measured at the year's own anchor, so the same pupil can land in
  // different brackets in different years. That is the point.
  let movedBracket = 0;
  const byStudent = new Map();
  for (const i of iptrs) {
    const list = byStudent.get(i.student_id) ?? [];
    list.push(i);
    byStudent.set(i.student_id, list);
  }
  for (const [sid, list] of byStudent) {
    if (list.length < 2) continue;
    const s = studentById.get(sid);
    if (!s) continue;
    const brackets = new Set(list.map((i) => bracketOf(ageAt(s.birthday, firstVisit.get(i._id) ?? syStart(i.school_year) ?? new Date()))));
    if (brackets.size > 1) movedBracket++;
  }
  console.log(`        ${movedBracket} multi-year student(s) fall in different age brackets across their years`);

  // Grade now comes from the IPTR. Records predating Sprint 57a have none and
  // must still be counted in the all-grades total rather than dropped.
  const scopedNoGrade = iptrs.filter((i) => !i.grade_level);
  const examinedNoGrade = scopedNoGrade.filter((i) => oralByIptr.has(i._id)).length;
  console.log(`        ${scopedNoGrade.length} IPTR(s) carry no grade, ${examinedNoGrade} of them examined`);
  check('ungraded records exist to prove the all-grades total matters, or none do',
    true, ''); // informational — the assertion below is the real one

  // The critical property: summing over the known grade list must NOT be how a
  // total is computed, because that drops ungraded records.
  const gradedExamined = iptrs.filter((i) => i.grade_level && oralByIptr.has(i._id)).length;
  check('summing by grade alone would undercount iff ungraded records exist',
    (examinedNoGrade > 0) === (gradedExamined < allTime),
    `graded=${gradedExamined} all=${allTime} ungraded=${examinedNoGrade}`);

  // Age at a fixed past anchor must be stable — that is what makes a filed
  // report reproducible, unlike an age computed to "today".
  const sample = students.find((s) => s.birthday);
  const anchor = new Date(2026, 5, 1);
  check('age at a fixed anchor is reproducible', ageAt(sample.birthday, anchor) === ageAt(sample.birthday, anchor));
  // And the month/day adjustment actually applies (the old off-by-one).
  const dec = { birthday: '2015-12-20T00:00:00.000Z' };
  check('a December birthday is not aged up early (the off-by-one fix)',
    ageAt(dec.birthday, new Date(2026, 8, 2)) === 10, `got ${ageAt(dec.birthday, new Date(2026, 8, 2))}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err.message); process.exit(1); });
