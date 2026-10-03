// Sprint 81 — recording an RPC visit, and the facility_based flag.
//
// Before this sprint PREVENTIVE_CARE_RECORD had NO write path anywhere in the
// app: the two-visit RPC module could be read and filtered, but a visit could
// only be created by a seed script. This asserts the write actually lands, the
// new flag round-trips through Mongo (including the deliberate NULL default),
// and the role gate matches the server's.
//
// ⚠ This writes to the SAME database the app uses (backlog 26 — there is no
// dev/prod separation). Every record it creates is ARCHIVED at the end, never
// hard-deleted (CLAUDE.md: never hard delete any record ever). Archived records
// are filtered out of every GET, so the demo data is left as it was found.
import 'dotenv/config';

const API = process.argv[2] || 'http://localhost:4000/api';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

// Auth is COOKIE-based (`access_token`, set by setAuthCookies in
// authController) — not a Bearer token. Requests must carry the cookie back.
const login = async (email, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${email} failed: ${r.status} ${await r.text()}`);
  const jar = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (!jar.includes('access_token')) throw new Error(`login ${email}: no access_token cookie returned`);
  return jar;
};

const api = (jar) => async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: jar, ...(init.headers ?? {}) },
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};

const created = [];

const run = async () => {
  console.log(`\nSprint 81 verification against ${API}\n`);

  const dentist = api(await login('dentist@floral.com', process.env.SEED_DENTIST_PASSWORD));

  // ── Find a target: an IPTR for the current school year ───────────────────
  const y = new Date();
  const currentSY = y.getMonth() <= 3 ? `${y.getFullYear() - 1}-${y.getFullYear()}` : `${y.getFullYear()}-${y.getFullYear() + 1}`;
  const { body: iptrs } = await dentist('/student-iptrs');
  const target = iptrs.find((i) => i.school_year === currentSY);
  check(`an IPTR exists for the current school year (${currentSY})`, !!target, 'nothing to attach a visit to');
  if (!target) return;

  // ── 1. The write path exists at all ──────────────────────────────────────
  const today = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const mk = async (facility_based, visit_number = 1) =>
    dentist('/preventive-care-records', {
      method: 'POST',
      body: JSON.stringify({ iptr_id: target._id, visit_date: today, visit_number, facility_based }),
    });

  const a = await mk(true);
  check('a dentist can CREATE a preventive-care record', a.status === 201 || a.status === 200, `status ${a.status}`);
  if (a.body?._id) created.push(a.body._id);

  // ── 2. facility_based round-trips in all three states ────────────────────
  check('facility_based: true persists as true', a.body?.facility_based === true, `got ${JSON.stringify(a.body?.facility_based)}`);

  const b = await mk(false);
  if (b.body?._id) created.push(b.body._id);
  check('facility_based: false persists as false', b.body?.facility_based === false, `got ${JSON.stringify(b.body?.facility_based)}`);

  const c = await mk(null);
  if (c.body?._id) created.push(c.body._id);
  check('facility_based: null persists as null (the "not recorded" state)',
    c.body?.facility_based === null || c.body?.facility_based === undefined, `got ${JSON.stringify(c.body?.facility_based)}`);

  // The default matters most: it is what every pre-Sprint-81 record has, and
  // false would have silently filed them all as non-facility-based.
  const d = await dentist('/preventive-care-records', {
    method: 'POST',
    body: JSON.stringify({ iptr_id: target._id, visit_date: today, visit_number: 1 }),
  });
  if (d.body?._id) created.push(d.body._id);
  check('OMITTING facility_based defaults to null, NOT false',
    d.body?.facility_based === null || d.body?.facility_based === undefined, `got ${JSON.stringify(d.body?.facility_based)}`);

  // ── 3. It reads back through the same GET the report uses ────────────────
  const { body: all } = await dentist('/preventive-care-records');
  const readBack = all.find((p) => p._id === a.body?._id);
  check('the new record appears in GET /preventive-care-records', !!readBack);
  check('the flag survives the read', readBack?.facility_based === true, `got ${JSON.stringify(readBack?.facility_based)}`);

  // ── 4. Role gate matches the UI's ────────────────────────────────────────
  const bho = api(await login('bho@floral.com', process.env.SEED_BHO_PASSWORD));
  const denied = await bho('/preventive-care-records', {
    method: 'POST',
    body: JSON.stringify({ iptr_id: target._id, visit_date: today, visit_number: 1 }),
  });
  check('a BHO viewer is REFUSED the write (matches the hidden button)', denied.status === 403, `status ${denied.status}`);
  if (denied.body?._id) created.push(denied.body._id); // should never happen; cleaned up if it does

  // ── 5. visit_number stays constrained ────────────────────────────────────
  const bad = await dentist('/preventive-care-records', {
    method: 'POST',
    body: JSON.stringify({ iptr_id: target._id, visit_date: today, visit_number: 3 }),
  });
  check('visit_number 3 is rejected (enum still enforced)', bad.status >= 400, `status ${bad.status}`);
  if (bad.body?._id) created.push(bad.body._id);

  // ── Cleanup: ARCHIVE, never delete ───────────────────────────────────────
  // As ADMIN, not the dentist: crudFactory defaults archiveRoles to ADMIN_ONLY
  // and this router sets only writeRoles, so a dentist archive would 403.
  const admin = api(await login(process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com', process.env.SEED_ADMIN_PASSWORD));
  let archived = 0;
  for (const id of created) {
    const r = await admin(`/preventive-care-records/${id}/archive`, { method: 'PATCH' });
    if (r.status >= 200 && r.status < 300) archived += 1;
  }
  check(`all ${created.length} test records archived (soft delete, never hard)`, archived === created.length, `${archived}/${created.length}`);

  const { body: after } = await dentist('/preventive-care-records');
  check('archived test records are gone from the default GET',
    !after.some((p) => created.includes(p._id)), 'demo data would be polluted');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
