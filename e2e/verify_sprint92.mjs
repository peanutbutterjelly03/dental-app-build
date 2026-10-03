// Sprint 92 — the audit trail read is bounded.
//
// The dangerous half of this change is NOT the bound, it is the interaction
// with the screen's own date filter. Before this, the client fetched every log
// and filtered in the browser, so any Start Date worked. A bounded fetch plus
// an unbounded-looking filter would report "No audit logs found" for a period
// that has plenty — a control that appears to work and lies, which CLAUDE.md
// names as worse than a missing feature. So the widening is asserted directly.
//
// Read-only: creates nothing.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  // Every request the app makes to /audit-trails, so the BOUND itself is
  // observed rather than inferred from the rendered table.
  const auditCalls = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/audit-trails')) auditCalls.push(u);
  });

  await page.goto(BASE);
  // The seeded admin email is configurable, so read it rather than assuming
  // the @floral.com pattern the other demo accounts use.
  await page.fill('input[type="email"]', process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // ⚠ A System Admin lands on a SCHOOL PICKER, not the dashboard — the nav
  // does not exist until a school is chosen. The dentist-based verifiers do
  // not hit this because their school is already set.
  await page.waitForTimeout(2500);
  const picker = page.locator('text=Select a school to continue');
  if (await picker.count()) {
    await page.getByText('BT Integrated School').first().click();
  }
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  console.log(`\nSprint 92 verification against ${BASE}\n`);

  // ── The dashboard's own fetch is bounded too ────────────────────────────
  await page.waitForTimeout(3500);
  const dashCalls = auditCalls.filter((u) => u.includes('from='));
  check('the admin dashboard fetches the audit trail WITH a from= bound',
    auditCalls.length > 0 && dashCalls.length === auditCalls.length,
    auditCalls.join(' | ') || 'no call seen');
  const body = await page.innerText('body');
  check('the Actions by Module chart says which window it covers',
    /Audit-trail entries per data model\s*·\s*last \d+ days/i.test(body.replace(/\s+/g, ' ')),
    (body.match(/Audit-trail entries per data model[^\n]*/) ?? ['not found'])[0]);

  // ── The audit trail screen ──────────────────────────────────────────────
  auditCalls.length = 0;
  await page.goto(`${BASE}/audit`);
  await page.waitForTimeout(3000);
  check('the screen fetches a bounded window', auditCalls.some((u) => u.includes('from=')),
    auditCalls.join(' | ') || 'no call seen');

  const header = await page.innerText('h1 + p, p');
  check('the header says the window, not a bare count',
    /since \d|all time/i.test(await page.innerText('body')), header);
  check('a "Show earlier" control is offered', await page.isVisible('button:has-text("Show earlier")'));

  // ── ⚠ THE TRAP: a Start Date earlier than the window must WIDEN the fetch
  auditCalls.length = 0;
  const dateInputs = page.locator('input[type="date"]');
  const dateCount = await dateInputs.count();
  check('the screen still offers its date filters', dateCount >= 1, `${dateCount} date inputs`);
  if (dateCount >= 1) {
    await dateInputs.first().fill('2020-01-01');
    await page.waitForTimeout(2500);
    const widened = auditCalls.some((u) => {
      const m = /from=([^&]+)/.exec(u);
      if (!m) return false;
      return new Date(decodeURIComponent(m[1])).getFullYear() <= 2020;
    });
    check('picking an earlier Start Date REFETCHES from that date (no silent empty table)',
      widened, auditCalls.join(' | ') || 'no refetch');
  }

  // ── "Show earlier" drops the bound entirely ─────────────────────────────
  auditCalls.length = 0;
  if (await page.isVisible('button:has-text("Show earlier")')) {
    await page.click('button:has-text("Show earlier")');
    await page.waitForTimeout(2500);
    check('"Show earlier" refetches with NO from= bound',
      auditCalls.length > 0 && auditCalls.every((u) => !u.includes('from=')),
      auditCalls.join(' | ') || 'no refetch');
    check('and the header switches to "all time"', /all time/i.test(await page.innerText('body')));
  }

  // ── The server rejects a malformed bound rather than ignoring it ────────
  const bad = await page.evaluate(async () => {
    const { apiClient } = await import('/src/app/api/client.ts');
    try { await apiClient.get('/audit-trails?from=not-a-date'); return 'accepted'; }
    catch (e) { return `rejected: ${e?.status ?? e?.message ?? e}`; }
  });
  check('a malformed from= is rejected, not silently ignored', bad.startsWith('rejected'), String(bad));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
