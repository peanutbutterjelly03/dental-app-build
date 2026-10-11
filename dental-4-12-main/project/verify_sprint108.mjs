// Sprint 108 — day notes. The part that most needs proving is NOT that a note
// saves, but that a barangay-wide note (school_id: null) survives Sprint 101's
// school scoping. A plain $in excludes null, which would have hidden every
// holiday from a scoped user while looking perfectly fine to an admin.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const results = [];
const check = (n, pass, detail) => results.push({ check: n, result: pass ? 'PASS' : 'FAIL', detail });

const login = async (email, pw) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};
const api = async (cookie, path, method = 'GET', body) => {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const dentist = await login('dentist@floral.com', env.SEED_DENTIST_PASSWORD);
const schoolAdmin = await login('schooladmin@floral.com', env.SEED_SCHOOLADMIN_PASSWORD);

// A throwaway far-future date, so nothing real is disturbed.
const DATE = '2097-12-25';
const schools = (await api(dentist, '/schools')).body;
const annexA = schools.find((s) => /Annex A/i.test(s.school_name));
const integrated = schools.find((s) => /Integrated/i.test(s.school_name));

// clean slate
for (const n of ((await api(dentist, `/day-notes?from=2097-12-01&to=2097-12-31`)).body ?? [])) {
  await api(dentist, `/day-notes/${n._id}/archive`, 'PATCH');
}

// --- 1. a barangay-wide note (no school)
const global = await api(dentist, '/day-notes', 'POST', { date: DATE, school_id: null, note: 'No clinic — barangay fiesta' });
check('a barangay-wide note saves (school_id null)', global.status === 201, `HTTP ${global.status}`);

// --- 2. a note for ONE school the school_admin is NOT in
const other = await api(dentist, '/day-notes', 'POST', { date: DATE, school_id: integrated._id, note: 'Integrated only' });
check('a school-specific note saves', other.status === 201, `HTTP ${other.status}`);

// --- 3. THE POINT: the scoped user must see the global one, not the other
const saNotes = ((await api(schoolAdmin, `/day-notes?from=2097-12-01&to=2097-12-31`)).body ?? []);
const texts = saNotes.map((n) => n.note);
check('scoped user SEES the barangay-wide note', texts.includes('No clinic — barangay fiesta'), texts.join(' | ') || '(none)');
check("scoped user does NOT see another school's note", !texts.includes('Integrated only'), texts.join(' | ') || '(none)');

// --- 4. the unscoped dentist sees both
const dNotes = ((await api(dentist, `/day-notes?from=2097-12-01&to=2097-12-31`)).body ?? []).map((n) => n.note);
check('unscoped user sees both', dNotes.includes('No clinic — barangay fiesta') && dNotes.includes('Integrated only'), dNotes.join(' | '));

// --- 5. the month bound actually bounds
const otherMonth = ((await api(dentist, `/day-notes?from=2097-01-01&to=2097-01-31`)).body ?? []).map((n) => n.note);
check('a different month returns none of them', !otherMonth.includes('Integrated only'), `${otherMonth.length} note(s)`);

// --- cleanup: archive, never hard delete
for (const n of ((await api(dentist, `/day-notes?from=2097-12-01&to=2097-12-31`)).body ?? [])) {
  await api(dentist, `/day-notes/${n._id}/archive`, 'PATCH');
}
const left = ((await api(dentist, `/day-notes?from=2097-12-01&to=2097-12-31`)).body ?? []);
check('cleanup — nothing left in live data', left.length === 0, `${left.length} live note(s)`);

console.table(results);
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
