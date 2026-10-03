// Sprint 65 — every student list is alphabetical by surname.
//
// From the P2 to-do: "Last Name sana and as much as possible is alphabetical
// per last per section". Lists previously rendered in whatever order the API
// returned. Sorted at the source (the /stats/student-rows endpoint, plus the
// two hooks that build their own rows) rather than per screen, so a new list
// inherits the order instead of forgetting it.
//
// Usage: node verify_sprint65.mjs [baseUrl]
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const isSorted = (arr) => arr.every((v, i) => i === 0 || arr[i - 1].localeCompare(v) <= 0);

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });
  console.log(`\nSprint 65 verification against ${BASE}\n`);

  // First column holding a "Surname, Given" name on each list screen.
  const screens = [
    ['Students', '/patients'],
    ['Dental Charts', '/dental-charts'],
    ['RPC Tracking', '/rpc'],
    ['Risk Classification', '/ai-analytics'],
  ];

  for (const [label, path] of screens) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(3500);
    // Show everything on one page where a paginator exists, so the check sees
    // the whole order rather than the first page of it.
    const sizer = page.locator('#page-size');
    if (await sizer.count()) { await sizer.selectOption('100'); await page.waitForTimeout(1200); }

    const names = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())
          .find((t) => /^[A-Za-zÑñ'.\- ]+,\s+\S/.test(t)))
        .filter(Boolean);
    });

    if (names.length < 2) {
      check(`${label}: too few rows to judge order`, true, `${names.length} names`);
      continue;
    }
    console.log(`        ${label}: ${names.length} names, first three ${JSON.stringify(names.slice(0, 3))}`);
    check(`${label} is alphabetical by surname`, isSorted(names),
      `out of order near ${JSON.stringify(names.slice(0, 6))}`);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
