// Sprint 25 E2E verification against the local backend (:4000) + Atlas.
// DB-assisted: OTP/reset tokens are planted directly (sha256 of known values)
// so no inbox round-trip is needed; the real email SEND path is exercised by
// the initiate call (lands harmlessly in the owner's inbox).
// Cleans up: temp user archived at the end.
import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import { readFileSync } from 'fs';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

const env = Object.fromEntries(readFileSync('./.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const BASE = 'http://localhost:4000/api';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; };
const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

await mongoose.connect(env.MONGODB_URI);
const db = mongoose.connection.db;

// admin session
const adminLogin = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }) });
check('admin login', adminLogin.ok);
const adminCookie = cookiesOf(adminLogin);

// temp user (email = real inbox so the one real send lands harmlessly)
const TEMP_EMAIL = env.BREVO_SENDER_EMAIL;
const TEMP_PW = 'TwofaTest@1234';
const created = await fetch(BASE + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ full_name: 'ZZ Twofa Test', email: TEMP_EMAIL, role: 'bho_staff', password: TEMP_PW }) });
check('temp user created', created.status === 201);
const tempUser = await created.json();
const uid = tempUser._id;

try {
  // 1. initiate (real email send path) — expect 200
  const init = await fetch(`${BASE}/users/${uid}/twofa/initiate`, { method: 'POST', headers: { Cookie: adminCookie } });
  check('twofa initiate sends (Brevo accepted)', init.ok, `status ${init.status}`);

  // 2. confirm with planted code
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(uid) }, { $set: { otp_hash: sha256('111222'), otp_expires: new Date(Date.now() + 600000) } });
  const badConfirm = await fetch(`${BASE}/users/${uid}/twofa/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ code: '999999' }) });
  check('confirm rejects wrong code', badConfirm.status === 401);
  const goodConfirm = await fetch(`${BASE}/users/${uid}/twofa/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ code: '111222' }) });
  check('confirm accepts planted code', goodConfirm.ok);
  const afterEnable = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(uid) });
  check('twofa_enabled set, otp cleared', afterEnable.twofa_enabled === true && !afterEnable.otp_hash);

  // 3. login now requires OTP, no cookies issued
  const l1 = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: TEMP_PW }) });
  const l1body = await l1.json();
  check('login returns twofa_required, no cookies', l1.ok && l1body.twofa_required === true && cookiesOf(l1) === '');

  // 4. verify-otp: wrong rejected, planted accepted, cookies issued, session works
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(uid) }, { $set: { otp_hash: sha256('333444'), otp_expires: new Date(Date.now() + 600000) } });
  const badOtp = await fetch(BASE + '/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, code: '000000' }) });
  check('verify-otp rejects wrong code', badOtp.status === 401);
  const goodOtp = await fetch(BASE + '/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, code: '333444' }) });
  const sessCookie = cookiesOf(goodOtp);
  check('verify-otp issues session', goodOtp.ok && sessCookie.includes('access_token'));
  const me = await fetch(BASE + '/auth/me', { headers: { Cookie: sessCookie } });
  check('session from OTP works (/auth/me 200)', me.ok);
  const reused = await fetch(BASE + '/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, code: '333444' }) });
  check('OTP is single-use', reused.status === 401);

  // 5. forgot/reset flow
  const forgot = await fetch(BASE + '/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'no-such-account@floral.com' }) });
  check('forgot-password generic 200 for unknown email', forgot.ok);
  await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(uid) }, { $set: { reset_token_hash: sha256('known-reset-token'), reset_token_expires: new Date(Date.now() + 600000) } });
  const badReset = await fetch(BASE + '/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong-token', password: 'NewPass@9999' }) });
  check('reset rejects wrong token', badReset.status === 401);
  const shortReset = await fetch(BASE + '/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'known-reset-token', password: 'short' }) });
  check('reset rejects short password', shortReset.status === 400);
  const goodReset = await fetch(BASE + '/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'known-reset-token', password: 'NewPass@9999' }) });
  check('reset accepts valid token', goodReset.ok);
  const l2 = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: 'NewPass@9999' }) });
  const l2body = await l2.json();
  check('new password works (and still asks for OTP)', l2.ok && l2body.twofa_required === true);
  const l3 = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: TEMP_PW }) });
  check('old password dead', l3.status === 401);

  // 6. disable -> normal login again
  const dis = await fetch(`${BASE}/users/${uid}/twofa/disable`, { method: 'POST', headers: { Cookie: adminCookie } });
  check('disable 2FA', dis.ok);
  const l4 = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: 'NewPass@9999' }) });
  check('login issues cookies again after disable', l4.ok && cookiesOf(l4).includes('access_token'));

  // 7. RBAC: non-admin cannot manage 2FA
  const staffCookie = cookiesOf(l4);
  const rbac = await fetch(`${BASE}/users/${uid}/twofa/disable`, { method: 'POST', headers: { Cookie: staffCookie } });
  check('non-admin blocked from twofa endpoints (403)', rbac.status === 403);

  // 8. audit entries
  const audits = await (await fetch(BASE + '/audit-trails', { headers: { Cookie: adminCookie } })).json();
  const actions = audits.filter((a) => a.affected_record_id === uid).map((a) => a.action);
  check('audit trail has 2FA lifecycle entries', ['Enabled 2FA', '2FA Login', 'Reset Password via Email', 'Disabled 2FA'].every((x) => actions.includes(x)), actions.join(', '));
} finally {
  // cleanup: archive temp user (soft delete, audited)
  const arch = await fetch(`${BASE}/users/${uid}/archive`, { method: 'PATCH', headers: { Cookie: adminCookie } });
  console.log('cleanup: temp user archived:', arch.status === 200 ? 'OK' : 'status ' + arch.status);
  await mongoose.disconnect();
}
console.log(failed ? 'RESULT: FAILURES PRESENT' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
