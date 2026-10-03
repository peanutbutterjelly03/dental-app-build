// Sprint 93 — today's date prefilled but still editable, and the one text
// colour that actually failed contrast.
//
// The contrast half is MEASURED, not eyeballed: the script reads the computed
// colour and background off the live DOM and applies the WCAG relative-luminance
// formula. "Looks fine" is not a check, and the failing element here was
// text-gray-400 at about 2.8:1 — visibly grey, and easy to defend by eye.
//
// Read-only: creates nothing. It fills the appointment form but never submits.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

/** Today in the browser's local timezone, as <input type="date"> formats it. */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.goto(BASE);
  await page.fill('input[type="email"]', process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // A System Admin lands on a school picker before the nav exists.
  await page.waitForTimeout(2500);
  if (await page.locator('text=Select a school to continue').count()) {
    await page.getByText('BT Integrated School').first().click();
  }
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  console.log(`\nSprint 93 verification against ${BASE}\n`);

  // ── The appointment date prefills with today, and stays editable ────────
  await page.goto(`${BASE}/appointments`);
  await page.waitForTimeout(2500);
  const newBtn = page.locator('button:has-text("New Appointment"), button:has-text("Create Appointment"), button:has-text("Schedule")').first();
  check('the create-appointment control is reachable', await newBtn.count() > 0);
  if (await newBtn.count()) {
    await newBtn.click();
    await page.waitForTimeout(1200);
    const dateInput = page.locator('input[type="date"]').first();
    const value = await dateInput.inputValue();
    check('the appointment date is prefilled with today', value === todayLocal(), `${value} vs ${todayLocal()}`);

    // ⚠ The whole point of the request: prefilled, NOT fixed.
    check('the date input is not readonly or disabled',
      !(await dateInput.getAttribute('readonly')) && !(await dateInput.isDisabled()));
    await dateInput.fill('2027-01-15');
    check('the prefilled date can still be edited', (await dateInput.inputValue()) === '2027-01-15');
  }

  // ── Contrast, computed from the live DOM ────────────────────────────────
  await page.goto(`${BASE}/accounts`);
  await page.waitForTimeout(2500);
  // The hint lives inside the Reset Password modal, not on the page. Opening it
  // is read-only — nothing is submitted.
  const resetBtn = page.locator('[title="Reset Password"], button:has-text("Reset Password")').first();
  if (await resetBtn.count()) {
    await resetBtn.click();
    await page.waitForTimeout(1200);
  }

  const contrast = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    /** Walk up for the first non-transparent background. */
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = parse(bg);
        if (p.length === 3 && !/rgba\(.*,\s*0\)/.test(bg)) return p;
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const el = [...document.querySelectorAll('div, p, span')]
      .find((n) => n.textContent.trim().startsWith('or set a password directly'));
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color);
    const bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return { ratio: Math.round(ratio * 100) / 100, fg, bg };
  });

  check('the "set a password directly" hint was found on the page', contrast !== null);
  if (contrast) {
    check(`its contrast meets WCAG AA for text (4.5:1) — measured ${contrast.ratio}:1`,
      contrast.ratio >= 4.5, `fg rgb(${contrast.fg}) on rgb(${contrast.bg})`);
  }

  // The muted token itself is what most of the app leans on, so measure it too
  // rather than trusting one element.
  const mutedRatio = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'text-muted-foreground';
    probe.textContent = 'probe';
    document.body.appendChild(probe);
    const parse = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fg = parse(getComputedStyle(probe).color);
    probe.remove();
    const L1 = lum(fg), L2 = lum([255, 255, 255]);
    return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
  });
  check(`the muted-foreground token itself passes AA on white — measured ${mutedRatio}:1`, mutedRatio >= 4.5);

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
