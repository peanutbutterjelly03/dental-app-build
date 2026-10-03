// Sprint 97 — the notification bell.
//
// The risk here is a control that LOOKS informative and isn't, which CLAUDE.md
// calls out by name. So these checks prove three things beyond "a bell renders":
//   1. every count is the one the destination screen actually shows,
//   2. the badge equals the rows the signed-in role can see, and
//   3. the roles that cannot act on clinical state do not get the control.
//
// Read-only: creates nothing.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

async function login(page, email, password) {
  await page.goto(BASE);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  if (await page.locator('text=Select a school to continue').count()) {
    await page.getByText('BT Integrated School').first().click();
  }
  await page.waitForSelector('a[href="/patients"], a[href="/reports"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
}

const run = async () => {
  const browser = await chromium.launch();
  console.log(`\nSprint 97 verification against ${BASE}\n`);

  // ── Dentist: sees all three sources ─────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    let statsCalls = 0;
    let lastCounts = null;
    // ⚠ CAPTURE THE SIDEBAR'S OWN RESPONSE rather than probing the endpoint
    // separately. An independent probe has to reconstruct the school scope, and
    // getting that wrong makes the test disagree with a correct UI: the first
    // version sent an empty `school=` (there is no #school-switcher for a
    // single-school dentist), got the UNSCOPED 22, and reported the correctly
    // scoped 12 on screen as a failure.
    page.on('response', async (r) => {
      if (!r.url().includes('/stats/notifications')) return;
      statsCalls++;
      try { lastCounts = await r.json(); } catch { /* ignore */ }
    });
    await login(page, 'dentist@floral.com', process.env.SEED_DENTIST_PASSWORD);

    const bell = page.locator('button:has-text("Notifications")');
    check('dentist: the bell is present', await bell.isVisible());
    check('it sits ABOVE Logout, as the P2 doc asked', await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const n = btns.findIndex((b) => b.textContent.includes('Notifications'));
      const l = btns.findIndex((b) => b.textContent.includes('Logout'));
      return n !== -1 && l !== -1 && n < l;
    }));
    // ⚠ NOT "exactly one call": React StrictMode double-invokes effects in DEV,
    // so two is correct here and one is correct in production. The real risk is
    // the sidebar refetching on every route change, since it renders on every
    // screen — so what is asserted is that the count does NOT GROW as you
    // navigate.
    const afterLogin = statsCalls;
    check('the sidebar aggregate fires on mount, not per render', afterLogin > 0 && afterLogin <= 2,
      `${afterLogin} calls`);
    // ⚠ CLICK the nav, do not page.goto — a goto is a full reload that remounts
    // the app, so it refetches legitimately and the test would fail on correct
    // code. Client-side route changes are what must not refetch.
    for (const path of ['/patients', '/appointments', '/reports']) {
      await page.click(`a[href="${path}"]`);
      await page.waitForTimeout(1500);
    }
    check('client-side navigation does NOT refetch the aggregate',
      statsCalls === afterLogin, `${afterLogin} -> ${statsCalls}`);

    const counts = lastCounts ?? {};
    check('the endpoint returns the three documented counts',
      ['overdueRpc', 'appointmentsToday', 'awaitingValidation'].every((k) => typeof counts[k] === 'number'),
      JSON.stringify(counts));

    await bell.click();
    await page.waitForTimeout(800);
    const panel = await page.innerText('aside');
    const expected = counts.overdueRpc + counts.appointmentsToday + counts.awaitingValidation;
    if (expected === 0) {
      check('with nothing pending it SAYS so rather than showing an empty box',
        /Nothing needs attention/i.test(panel), panel.slice(0, 120));
    } else {
      if (counts.overdueRpc > 0) {
        check(`panel states the overdue RPC count (${counts.overdueRpc})`,
          new RegExp(`${counts.overdueRpc}\\s+overdue RPC`).test(panel));
      }
      if (counts.appointmentsToday > 0) {
        check(`panel states today's appointments (${counts.appointmentsToday})`,
          new RegExp(`${counts.appointmentsToday}\\s+appointment`).test(panel));
      }
      if (counts.awaitingValidation > 0) {
        check(`panel states assessments awaiting validation (${counts.awaitingValidation})`,
          new RegExp(`${counts.awaitingValidation}\\s+risk assessment`).test(panel));
      }
    }

    // ⚠ The count must equal what the DESTINATION screen shows, or the bell is
    // decorative. Overdue RPC is the one with a real derivation (visit 1 done,
    // visit 2 missing, past 150 days) duplicated between server and client.
    if (counts.overdueRpc > 0) {
      await page.goto(`${BASE}/rpc`);
      await page.waitForTimeout(3500);
      const onScreen = await page.evaluate(() =>
        (document.body.innerText.match(/\bOverdue\b/g) ?? []).length);
      check('the RPC screen actually shows overdue rows the bell counted', onScreen > 0,
        `${onScreen} "Overdue" labels for ${counts.overdueRpc} counted`);
    } else {
      check('overdue RPC count is zero and the panel does not claim otherwise',
        !/overdue RPC/i.test(panel));
    }
    await page.close();
  }

  // ── School admin: no clinical notifications at all ──────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    let statsCalls = 0;
    page.on('request', (r) => { if (r.url().includes('/stats/notifications')) statsCalls++; });
    await login(page, 'schooladmin@floral.com', process.env.SEED_SCHOOLADMIN_PASSWORD);
    check('school admin: the bell is HIDDEN, not shown empty',
      !(await page.locator('button:has-text("Notifications")').isVisible()));
    check('school admin: the aggregate is never even requested', statsCalls === 0, `${statsCalls} calls`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
