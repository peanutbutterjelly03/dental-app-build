// Sprint 58 — shared pagination across the four list screens, and a save toast
// that is actually noticeable.
//
// Pagination came from a classmate's screenshot (items-per-page, a range label,
// first/last buttons). Only PatientList paged before; DentalChartList,
// TreatmentRecords and RPCTracking rendered every filtered row.
//
// Usage: node verify_sprint58.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const SCREENS = [
  ['Students', '/patients'],
  ['Dental Charts', '/dental-charts'],
  ['Treatment', '/treatment-records'],
  ['RPC Tracking', '/rpc'],
];

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for something that only exists AFTER sign-in. 'nav, aside' used to
  // work, but the split login (Sprint 61) put an <aside> on the login page
  // itself, so that selector matched instantly and the script carried on
  // unauthenticated.
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  for (const [label, path] of SCREENS) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(2500);

    let sizer = page.locator('#page-size');
    // An empty list renders no footer, so no pager — that is correct, not a
    // failure. Treatment Records starts empty (no Treatment docs seeded) and
    // offers a "Full List" toggle that populates it; use it so the pager is
    // actually exercised rather than skipped.
    if (await sizer.count() === 0) {
      const fullList = page.locator('button:has-text("Full List")').first();
      if (await fullList.count()) {
        await fullList.click();
        await page.waitForTimeout(2000);
        sizer = page.locator('#page-size');
      }
    }
    const hasSizer = await sizer.count() > 0;
    if (!hasSizer) {
      const empty = (await page.locator('tbody').innerText().catch(() => '')).toLowerCase();
      const looksEmpty = empty.includes('no ') || empty.trim() === '';
      check(`${label}: pager correctly absent on an empty list`, looksEmpty, `tbody: ${empty.slice(0, 80)}`);
      continue;
    }
    check(`${label}: has the items-per-page control`, true);

    const opts = await sizer.locator('option').allTextContents();
    check(`${label}: offers 10/25/50/100`, JSON.stringify(opts) === '["10","25","50","100"]', JSON.stringify(opts));

    // Row count must actually follow the page size. Counted from the table
    // body so the header row cannot inflate it.
    const rows = () => page.locator('tbody tr').count();
    await sizer.selectOption('10');
    await page.waitForTimeout(700);
    const at10 = await rows();
    await sizer.selectOption('50');
    await page.waitForTimeout(700);
    const at50 = await rows();
    check(`${label}: page size changes the rows shown`, at10 <= 10 && at50 >= at10, `10→${at10} rows, 50→${at50} rows`);

    // With a small dataset there may be only one page, in which case the pager
    // is hidden on purpose — assert that, rather than assuming buttons exist.
    await sizer.selectOption('10');
    await page.waitForTimeout(700);
    const total = Number((await page.locator('text=/\\d+–\\d+ of \\d+/').first().innerText().catch(() => '0–0 of 0')).match(/of (\d+)/)?.[1] ?? 0);
    const nextBtn = page.locator('button[aria-label="Next page"]');
    const lastBtn = page.locator('button[aria-label="Last page"]');
    if (total > 10) {
      check(`${label}: shows first/last buttons on a multi-page list`, await lastBtn.count() > 0);
      const before = await page.locator('tbody tr').first().innerText();
      await nextBtn.click();
      await page.waitForTimeout(700);
      const after = await page.locator('tbody tr').first().innerText();
      check(`${label}: Next actually changes the rows`, before !== after);
      // Only click Last if it is still enabled — a short list can already be
      // on its final page after one Next, and Last is correctly disabled there.
      if (!(await lastBtn.isDisabled())) {
        await lastBtn.click();
        await page.waitForTimeout(700);
      }
      check(`${label}: Last disables itself at the end`, await lastBtn.isDisabled());
      check(`${label}: First is enabled once off page 1`, !(await page.locator('button[aria-label="First page"]').isDisabled()));
    } else {
      check(`${label}: pager hidden when everything fits one page`, await nextBtn.count() === 0, `${total} rows`);
    }
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  // Saving a dental chart is the cheapest real mutation to trigger.
  await page.goto(`${BASE}/dental-charts`);
  await page.waitForTimeout(2500);
  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForTimeout(3000);
    const edit = page.locator('button:has-text("Edit Chart")').first();
    if (await edit.count()) {
      await edit.click();
      await page.waitForTimeout(800);
      const save = page.locator('button:has-text("Save")').first();
      if (await save.count()) {
        await save.click();
        const toast = page.locator('[role="status"], [role="alert"]').first();
        await toast.waitFor({ timeout: 8000 }).catch(() => {});
        const visible = await toast.isVisible().catch(() => false);
        check('a save shows a toast', visible);
        if (visible) {
          const box = await toast.boundingBox();
          const vw = page.viewportSize().width;
          check('the toast is at the TOP of the screen', box.y < 200, `y=${Math.round(box?.y ?? -1)}`);
          const centred = Math.abs((box.x + box.width / 2) - vw / 2) < 80;
          check('the toast is horizontally centred', centred, `centre off by ${Math.round(Math.abs((box.x + box.width / 2) - vw / 2))}px`);
          const bg = await toast.evaluate((el) => getComputedStyle(el).backgroundColor);
          check('the success toast is filled green, not a white card', bg.replace(/\s/g, '') === 'rgb(21,128,61)', bg);
          await page.screenshot({ path: 'sprint58_toast.png' });
        }
      } else check('a save shows a toast', false, 'no Save button found');
    } else check('a save shows a toast', false, 'no Edit Chart button found');
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
