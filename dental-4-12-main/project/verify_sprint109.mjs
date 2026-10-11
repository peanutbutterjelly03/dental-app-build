// Sprint 109 — a note on ONE appointment.
//
// The risk worth testing is not "does it save" but "does it save against the
// RIGHT pupil". Appointments are grouped into sessions, and the note is
// addressed by appointmentId; if that were ever matched positionally against
// the session's appointmentIds array, a note would land on a neighbour.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = process.env.BASE_URL || 'https://dental-app-build.vercel.app';

const results = [];
const check = (n, pass, detail) => results.push({ check: n, result: pass ? 'PASS' : 'FAIL', detail });

const lr = await fetch(`${BASE}/api/auth/login`, {
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

const appts = (await api('/appointments')).body ?? [];
check('appointments readable', appts.length > 0, `${appts.length} found`);
if (appts.length < 2) {
  console.table(results);
  console.log('\nneed at least 2 appointments to prove targeting — stopping');
  process.exit(1);
}

const [a, b] = appts;
const originalA = a.notes ?? '';
const originalB = b.notes ?? '';

// --- the field exists and round-trips
const MARK = `sprint109 ${Date.now()}`;
const put = await api(`/appointments/${a._id}`, 'PUT', { notes: MARK });
check('notes saves on an appointment', put.status === 200, `HTTP ${put.status}`);

const after = (await api('/appointments')).body ?? [];
const gotA = after.find((x) => x._id === a._id);
const gotB = after.find((x) => x._id === b._id);
check('the note is on the appointment it was written for', gotA?.notes === MARK, `${gotA?.notes}`);
check('the neighbouring appointment is untouched', (gotB?.notes ?? '') === originalB,
  `expected "${originalB}", got "${gotB?.notes ?? ''}"`);

// --- it must not disturb the rest of the record
check('status / type / student unchanged', gotA.status === a.status && gotA.appointment_type === a.appointment_type && gotA.student_id === a.student_id,
  `${gotA.status} · ${gotA.appointment_type}`);

// --- clearing works (an empty remark is a real state, not a missing one)
const cleared = await api(`/appointments/${a._id}`, 'PUT', { notes: '' });
const afterClear = ((await api('/appointments')).body ?? []).find((x) => x._id === a._id);
check('a note can be cleared', cleared.status === 200 && (afterClear.notes ?? '') === '', `"${afterClear?.notes ?? ''}"`);

// --- restore whatever was there before
await api(`/appointments/${a._id}`, 'PUT', { notes: originalA });
const restored = ((await api('/appointments')).body ?? []).find((x) => x._id === a._id);
check('cleanup — original value restored', (restored.notes ?? '') === originalA, `"${restored?.notes ?? ''}"`);

console.table(results);
const failed = results.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `\n${failed.length} FAILED` : `\n${results.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
