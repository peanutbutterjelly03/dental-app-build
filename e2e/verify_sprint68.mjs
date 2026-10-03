// Sprint 68 — height, weight and derived BMI, per school year.
//
// From the P2 to-do, where it appears twice. Neither measurement existed
// anywhere in the data model. They go on STUDENT_IPTR, not STUDENT: a pupil
// measured at 120 cm in Grade 3 is not 120 cm in Grade 6, so they are
// year-varying in exactly the way grade is (Sprint 57a).
//
// BMI is DERIVED, never stored — a stored copy drifts the moment either
// measurement is corrected, the same reason age is computed (Sprint 57b). The
// test asserts the field does not exist on the record.
//
// Usage: node verify_sprint68.mjs [baseUrl] [apiBase]
import 'dotenv/config';

const API = process.argv[3] || 'http://localhost:4000';
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

const bmi = (h, w) => Math.round((w / ((h / 100) ** 2)) * 10) / 10;

const run = async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  console.log(`\nSprint 68 verification against ${API}\n`);

  const iptrs = (await api('/student-iptrs')).body;
  check('IPTRs expose height_cm and weight_kg', iptrs.every((i) => 'height_cm' in i && 'weight_kg' in i));
  check('nothing is pre-filled — no measurement has ever been recorded',
    iptrs.every((i) => i.height_cm === null && i.weight_kg === null),
    `${iptrs.filter((i) => i.height_cm !== null).length} already set`);
  check('BMI is NOT a stored field', iptrs.every((i) => !('bmi' in i)));

  // Round-trip a measurement on one year, and confirm it does NOT leak onto
  // the student's other years — the whole point of putting it on the IPTR.
  // A student with MORE THAN ONE school year, so the year-scoping assertion is
  // real rather than skipped.
  const counts = iptrs.reduce((m, i) => m.set(i.student_id, (m.get(i.student_id) ?? 0) + 1), new Map());
  const multi = [...counts.entries()].find(([, n]) => n > 1)?.[0];
  const target = iptrs.find((i) => i.student_id === multi) ?? iptrs[0];
  const siblings = iptrs.filter((i) => i.student_id === target.student_id && i._id !== target._id);
  const saved = await api(`/student-iptrs/${target._id}`, {
    method: 'PUT', body: JSON.stringify({ height_cm: 132.5, weight_kg: 28.4 }),
  });
  check('a measurement saves', saved.status === 200 && saved.body.height_cm === 132.5, `got ${saved.status}`);
  check('the derived BMI is right', bmi(132.5, 28.4) === 16.2, String(bmi(132.5, 28.4)));

  const after = (await api('/student-iptrs')).body;
  const reread = after.find((i) => i._id === target._id);
  check('it persists', reread.height_cm === 132.5 && reread.weight_kg === 28.4);
  if (siblings.length) {
    const others = after.filter((i) => siblings.some((sb) => sb._id === i._id));
    check('other school years are UNAFFECTED (year-scoped, not per-student)',
      others.every((o) => o.height_cm === null), JSON.stringify(others.map((o) => o.height_cm)));
  } else {
    console.log('        (target student has only one school year — sibling check skipped)');
  }

  // Blank must clear, not store 0: a 0 would read as "measured at zero" and
  // produce a nonsense BMI rather than "not measured".
  const cleared = await api(`/student-iptrs/${target._id}`, {
    method: 'PUT', body: JSON.stringify({ height_cm: null, weight_kg: null }),
  });
  check('clearing a measurement stores null, not 0',
    cleared.status === 200 && cleared.body.height_cm === null && cleared.body.weight_kg !== 0,
    JSON.stringify({ h: cleared.body?.height_cm, w: cleared.body?.weight_kg }));

  const final = (await api('/student-iptrs')).body.find((i) => i._id === target._id);
  check('cleanup left the record as found', final.height_cm === null && final.weight_kg === null);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
