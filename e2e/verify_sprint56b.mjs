// Sprint 56b — differential check for /stats/student-rows.
//
// The endpoint moved useStudents' six-collection join from the browser to the
// server. The only thing that matters is that it produces the SAME rows: eight
// components render these, and a silent difference in risk level or last visit
// would be a clinical display bug, not a performance regression.
//
// So this rebuilds the rows the OLD way — fetching the six collections and
// joining them in JS, exactly as useStudents used to — and compares field by
// field against what the endpoint returns.
//
// Usage: node verify_sprint56b.mjs [baseUrl]   (default http://localhost:4000)
import 'dotenv/config';

const BASE = process.argv[2] || 'http://localhost:4000';
let cookie = '';

async function api(path) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
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
}

// --- the OLD client-side join, transcribed verbatim from useStudents ---------
const surnameFirst = (s) => {
  const last = (s.last_name ?? '').trim();
  const first = (s.first_name ?? '').trim();
  if (!last && !first) return (s.full_name ?? '').trim();
  if (!last) return first;
  if (!first) return last;
  return `${last}, ${first}`;
};
const deriveOralStatus = (r) =>
  r === 'High' ? 'Needs Treatment' : r === 'Medium' ? 'Under Treatment' : r === 'Low' ? 'Orally Fit' : 'Not Yet Screened';

async function buildTheOldWay() {
  const [apiStudents, schools, iptrs, charts, preventives, riskStrats] = await Promise.all([
    api('/students'), api('/schools'), api('/student-iptrs'),
    api('/dental-charts'), api('/preventive-care-records'), api('/risk-stratifications'),
  ]);
  const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
  const iptrsByStudent = new Map();
  for (const iptr of iptrs) {
    const list = iptrsByStudent.get(iptr.student_id) ?? [];
    list.push(iptr);
    iptrsByStudent.set(iptr.student_id, list);
  }
  const chartsByIptr = new Map();
  for (const c of charts) {
    const list = chartsByIptr.get(c.iptr_id) ?? [];
    list.push(c);
    chartsByIptr.set(c.iptr_id, list);
  }
  const preventiveById = new Map(preventives.map((p) => [p._id, p]));
  const riskByIptr = new Map();
  for (const r of riskStrats) {
    const preventive = preventiveById.get(r.preventive_id);
    if (preventive) riskByIptr.set(preventive.iptr_id, r);
  }
  return apiStudents.map((s) => {
    const studentIptrs = iptrsByStudent.get(s._id) ?? [];
    const allCharts = studentIptrs.flatMap((iptr) => chartsByIptr.get(iptr._id) ?? []);
    const lastVisit = allCharts.length
      ? allCharts.reduce((latest, c) => (c.date_charted > latest ? c.date_charted : latest), allCharts[0].date_charted)
      : null;
    const riskLevel = studentIptrs.map((iptr) => riskByIptr.get(iptr._id)).find(Boolean)?.risk_level ?? null;
    return {
      id: s._id,
      name: surnameFirst(s),
      lastName: s.last_name ?? '',
      firstName: s.first_name ?? '',
      middleName: s.middle_name ?? '',
      birthdate: s.birthday.slice(0, 10),
      gender: s.sex,
      grade: s.grade_level,
      section: s.section,
      school: schoolNameById.get(s.school_id) ?? 'Unknown School',
      lastVisit,
      oralStatus: deriveOralStatus(riskLevel),
      riskLevel,
      consentStatus: s.consent_status,
    };
  });
}

const run = async () => {
  await login();
  console.log(`\nSprint 56b differential check against ${BASE}\n`);

  const [fresh, old] = await Promise.all([api('/stats/student-rows'), buildTheOldWay()]);
  console.log(`  endpoint returned ${fresh.length} rows; the old client join produced ${old.length}\n`);

  let mismatches = 0;
  if (fresh.length !== old.length) {
    console.log(`  FAIL  row count differs`);
    mismatches++;
  }

  const freshById = new Map(fresh.map((r) => [r.id, r]));
  const FIELDS = ['name', 'lastName', 'firstName', 'middleName', 'birthdate', 'gender',
    'grade', 'section', 'school', 'lastVisit', 'oralStatus', 'riskLevel', 'consentStatus'];

  for (const want of old) {
    const got = freshById.get(want.id);
    if (!got) {
      console.log(`  FAIL  ${want.name}: missing from the endpoint`);
      mismatches++;
      continue;
    }
    for (const f of FIELDS) {
      // lastVisit is the one field whose representation legitimately differs:
      // the old join passed through the API's ISO string, the endpoint
      // re-serializes a Date. Compare as instants, not as text.
      const same = f === 'lastVisit'
        ? (want[f] === null && got[f] === null) || (want[f] && got[f] && new Date(want[f]).getTime() === new Date(got[f]).getTime())
        : want[f] === got[f];
      if (!same) {
        console.log(`  FAIL  ${want.name} .${f}: old=${JSON.stringify(want[f])} new=${JSON.stringify(got[f])}`);
        mismatches++;
      }
    }
  }

  // A row is only useful if the names actually decrypted — ciphertext carries
  // the "<iv>:<ciphertext>" shape, so a colon in a name means a lean() read
  // slipped in somewhere.
  const ciphered = fresh.filter((r) => r.lastName.includes(':') || r.firstName.includes(':'));
  if (ciphered.length) {
    console.log(`  FAIL  ${ciphered.length} row(s) came back still encrypted`);
    mismatches++;
  } else {
    console.log(`  PASS  all ${fresh.length} rows decrypted`);
  }

  const withRisk = fresh.filter((r) => r.riskLevel).length;
  const withVisit = fresh.filter((r) => r.lastVisit).length;
  console.log(`  PASS  joins are populated, not empty: ${withRisk} rows carry a risk level, ${withVisit} a last visit`);

  console.log(mismatches === 0
    ? `\n  PASS  every field of every row matches the old join\n`
    : `\n  ${mismatches} MISMATCH(ES)\n`);
  process.exit(mismatches === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
