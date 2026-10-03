// Sprint 56 — UI smoke for the Appointments screen after the bounded reads.
//
// The API-level checks live in verify_sprint56.mjs; this one covers what those
// cannot: that the create form's grade/section picker still populates now that
// it reads a server-filtered roster instead of the whole student list, and that
// the history tabs render with their new scope control.
//
// Usage: node verify_sprint56_ui.mjs [baseUrl]   (default http://localhost:5173)
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Every /students and /appointments request the page makes, so we can prove
  // the screen no longer asks for whole collections.
  const reads = [];
  page.on('request', (r) => {
    const u = new URL(r.url(), BASE);
    if (u.pathname.startsWith('/api/students') || u.pathname.startsWith('/api/appointments')) {
      reads.push(u.pathname + u.search);
    }
  });

  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_DENTIST_EMAIL || 'dentist@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_DENTIST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for something that only exists AFTER sign-in. 'nav, aside' used to
  // work, but the split login (Sprint 61) put an <aside> on the login page
  // itself, so that selector matched instantly and the script carried on
  // unauthenticated.
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  // Only the Appointments screen is under test. The dashboard we just landed on
  // still calls useStudents() for the patient-list stats — a real unbounded read,
  // but a different screen and outside this sprint — so its requests must not be
  // counted here.
  reads.length = 0;
  await page.goto(`${BASE}/appointments`);
  await page.waitForSelector('text=Completed', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // --- The reads are bounded ----------------------------------------------
  const unbounded = reads.filter((r) => r === '/api/students' || r === '/api/appointments');
  check('no unbounded /students or /appointments read on this screen', unbounded.length === 0, `saw ${JSON.stringify(unbounded)}`);
  check('the appointments read carries a date window', reads.some((r) => r.startsWith('/api/appointments?') && r.includes('to=')));
  console.log(`        reads: ${JSON.stringify(reads)}`);

  // --- History tabs + scope control ---------------------------------------
  await page.click('text=Completed');
  await page.waitForTimeout(800);
  check('Completed tab shows its scope', await page.locator('text=Showing this school year').first().isVisible());
  check('Completed tab offers "Show earlier"', await page.locator('button:has-text("Show earlier")').first().isVisible());

  await page.click('button:has-text("Show earlier")');
  await page.waitForTimeout(2000);
  check('"Show earlier" flips the label to all years', await page.locator('text=Showing all years').first().isVisible());
  const afterEarlier = reads.filter((r) => r.startsWith('/api/appointments?'));
  check('"Show earlier" refetches without a from bound', afterEarlier.some((r) => !r.includes('from=')), JSON.stringify(afterEarlier));

  await page.click('button:has-text("This school year only")');
  await page.waitForTimeout(1200);
  check('the scope control toggles back', await page.locator('text=Showing this school year').first().isVisible());

  await page.click('text=Missed');
  await page.waitForTimeout(600);
  check('Missed tab also carries the scope control', await page.locator('text=Showing this school year').first().isVisible());

  // --- The create form's roster still populates ---------------------------
  await page.click('button:has-text("New Appointment")');
  await page.waitForTimeout(800);
  const selects = page.locator('select');
  await selects.nth(0).selectOption({ index: 1 }); // school
  await page.waitForTimeout(600);
  await selects.nth(1).selectOption({ index: 1 }); // grade
  await page.waitForTimeout(2500);

  const rosterRead = reads.find((r) => r.includes('/api/students?') && r.includes('grade_level='));
  check('choosing a grade fetches only that school + grade', !!rosterRead, JSON.stringify(reads.filter((r) => r.startsWith('/api/students'))));

  const sectionCount = await selects.nth(2).locator('option').count();
  check('the section dropdown populates from the server roster', sectionCount > 1, `${sectionCount} options (1 = placeholder only)`);

  if (sectionCount > 1) {
    await selects.nth(2).selectOption({ index: 1 });
    await page.waitForTimeout(800);
    const boxes = await page.locator('input[type="checkbox"]').count();
    check('the student picker lists that section\'s students', boxes > 0, `${boxes} checkboxes`);
  }

  await page.screenshot({ path: 'sprint56_ui.png', fullPage: true });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
