// Sprint 74 — Promote / Assign.
//
// Rollover for a whole section in one reviewed action. Backlog 23 called this
// "option A" and deferred it; the classmate's prototype arrived at the same
// answer independently.
//
// The assertion that matters is NOT that a new record appears — it is that
// LAST year's record is left exactly as it was. That is the whole point of
// Sprint 57a: a promotion must not rewrite history. This drives the flow in a
// browser and then checks the database on both sides of the change.
//
// Usage: node verify_sprint74.mjs [baseUrl] [apiBase]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
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
const sy = (d = new Date()) => (d.getMonth() <= 3 ? `${d.getFullYear() - 1}-${d.getFullYear()}` : `${d.getFullYear()}-${d.getFullYear() + 1}`);
const nextSy = (s) => { const [a, b] = s.split('-').map(Number); return `${a + 1}-${b + 1}`; };

const run = async () => {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com', password: process.env.SEED_DENTIST_PASSWORD }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const TO = nextSy(sy());
  console.log(`\nSprint 74 verification against ${BASE}  (${sy()} → ${TO})\n`);

  // Snapshot BEFORE: every existing IPTR, so "history untouched" is provable.
  const before = (await api('/student-iptrs')).body;
  const beforeById = new Map(before.map((i) => [i._id, i]));
  const createdIds = [];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });
  await page.goto(`${BASE}/patients`);
  await page.waitForTimeout(3000);

  await page.click('button:has-text("Promote / Assign")');
  await page.waitForTimeout(1500);
  const modal = page.locator('dialog, [role="dialog"]').first();
  check('the Promote / Assign screen opens', await modal.locator('text=Promote / Assign').count() > 0);
  check('it names the target school year', (await modal.innerText()).includes(TO));

  // Pick a grade with pupils in it.
  await modal.locator('select[aria-label="Grade"]').selectOption('Grade 1');
  await page.waitForTimeout(3000);
  const rowCount = await modal.locator('tbody tr').count();
  console.log(`        Grade 1 roster: ${rowCount} pupil(s)`);
  check('the roster loads for the chosen grade', rowCount > 0);
  check('it says what will happen before doing it',
    (await modal.innerText()).includes(`will get a ${TO} record`));

  if (rowCount === 0) { await browser.close(); process.exit(1); }

  // Retain the first pupil — the case the dentist raised — and promote the
  // rest. Waits first: the roster and the existing-year lookup arrive in two
  // requests, and choosing before both land used to have the choice wiped.
  await page.waitForTimeout(2500);
  await modal.locator('tbody tr').first().locator('select').selectOption('retain');
  await page.waitForTimeout(1500);
  const chosen = await modal.locator('tbody tr').first().locator('select').inputValue();
  check('a per-pupil choice survives the roster refresh', chosen === 'retain', chosen);

  await modal.locator(`button:has-text("Open ${TO} for")`).click();
  await page.waitForTimeout(6000);
  const summary = await modal.innerText();
  console.log(`        summary: ${summary.split('\n').find((l) => l.includes('moved into')) ?? '(none)'}`);
  check('it reports a summary rather than failing silently', summary.includes('moved into'));

  await browser.close();

  // ── The assertions that matter, against the database ────────────────────
  const after = (await api('/student-iptrs')).body;
  const newOnes = after.filter((i) => !beforeById.has(i._id));
  createdIds.push(...newOnes.map((i) => i._id));
  check('new records were created for the target year', newOnes.length > 0, `${newOnes.length}`);
  check('every new record is for the TARGET year only',
    newOnes.every((i) => i.school_year === TO), JSON.stringify([...new Set(newOnes.map((i) => i.school_year))]));
  check('every new record carries a grade (57a)', newOnes.every((i) => !!i.grade_level));

  // HISTORY UNTOUCHED — the point of the whole design.
  const changed = after.filter((i) => beforeById.has(i._id)).filter((i) => {
    const b = beforeById.get(i._id);
    return b.grade_level !== i.grade_level || b.section !== i.section || b.school_year !== i.school_year;
  });
  check('NO pre-existing school year was modified', changed.length === 0,
    JSON.stringify(changed.map((c) => ({ sy: c.school_year, was: beforeById.get(c._id).grade_level, now: c.grade_level }))));

  // A retained pupil kept their grade; a promoted one moved up exactly one.
  const retained = newOnes.filter((i) => i.grade_level === 'Grade 1');
  const promoted = newOnes.filter((i) => i.grade_level === 'Grade 2');
  console.log(`        ${promoted.length} promoted to Grade 2, ${retained.length} retained in Grade 1`);
  check('retained pupils repeat their grade', retained.length === 1, `${retained.length}`);
  check('promoted pupils move up exactly one grade', promoted.length === newOnes.length - retained.length);

  // Re-running must not double-create — uniqueBy guards it server-side.
  const dup = await api('/student-iptrs', {
    method: 'POST',
    body: JSON.stringify({ student_id: newOnes[0].student_id, school_year: TO, grade_level: 'Grade 2', section: 'X' }),
  });
  check('a second record for the same pupil+year is refused (409)', dup.status === 409, `got ${dup.status}`);

  // ── Clean up: archive everything created, as admin ──────────────────────
  const adminLogin = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }),
  });
  cookie = (adminLogin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  for (const id of createdIds) await api(`/student-iptrs/${id}/archive`, { method: 'PATCH' });
  // Put the students' current grade back to what it was.
  for (const i of newOnes) {
    const was = before.find((b) => b.student_id === i.student_id && b.school_year === sy());
    if (was?.grade_level) await api(`/students/${i.student_id}`, { method: 'PUT', body: JSON.stringify({ grade_level: was.grade_level, section: was.section }) });
  }
  const final = (await api('/student-iptrs')).body;
  check('cleanup left the IPTR count as found', final.length === before.length, `${final.length} vs ${before.length}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
