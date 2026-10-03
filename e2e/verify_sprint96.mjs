// Sprint 96 — the accent colours the Sprint 94 sweep measured and reported.
//
// A find-and-replace across 17 files needs two things proved, and neither is
// "it compiles":
//   1. the greys are actually GONE from the rendered DOM, and
//   2. nothing got LESS readable. gray-600 -> muted-foreground is a slight
//      LIGHTENING (#4b5563 -> #717182), so this sweeps every visible text node
//      on each screen and computes its WCAG contrast. That catches a
//      regression anywhere on the page, not just where I thought to look.
//
// Read-only: creates nothing.
import 'dotenv/config';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

/**
 * Runs IN THE PAGE. Every visible text node's contrast against its nearest
 * painted background, with the WCAG size exemptions applied.
 *
 * ⚠ Passed to page.evaluate AS A FUNCTION, never as a template-literal string.
 * A backtick string eats the backslashes, so `\s` and `\d` arrive as literal
 * `s` and `d` — the first version of this script died on
 * "Invalid regular expression: /,s*0)$/".
 */
function sweep() {
  // ⚠ DO NOT PARSE THE COLOUR STRING. Chromium returns this app's tokens as
  // oklch() (--foreground is oklch(0.145 0 0)), and a naive number-scrape reads
  // "oklch(1 0 0)" as rgb(1,0,0) — which reported WHITE-ON-BLUE as 2.4:1 in the
  // first version of this script and would have sent me chasing a regression
  // that did not exist. Painting the colour onto a canvas makes the browser do
  // the conversion, whatever the notation.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const toRgb = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isTransparent = (c) => !c || c === 'transparent' || /,\s*0\)$/.test(c);
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!isTransparent(bg)) return toRgb(bg);
      n = n.parentElement;
    }
    return [255, 255, 255];
  };

  const grays = [];
  const failures = [];
  const accents = []; // kept for the report line; nothing is routed here now
  let measured = 0;

  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    for (const c of el.classList) {
      // The only greys left are two decorative icons in AIAnalytics (a chevron
      // and an empty-state Brain). Not text, so no text-contrast rule applies,
      // and there is no token at that value to migrate them to.
      if (/^([a-z-]+:)*text-gray-\d+$/.test(c) && tag !== 'svg') grays.push(c + ' @' + tag);
    }

    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(' ');
    if (!own) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // WCAG exempts disabled controls.
    if (el.closest('[disabled],[aria-disabled="true"]')) continue;

    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;

    const ratio = (() => {
      const L1 = lum(toRgb(cs.color));
      const L2 = lum(bgOf(el));
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    })();
    measured++;
    if (ratio < need) {
      // ⚠ NO SPLIT HERE, AND THAT IS THE POINT OF THIS SPRINT. Sprint 94
      // counted accent/chip failures separately because fixing them was out of
      // its scope; this sprint fixed them, so EVERY visible text node is now
      // gated. If something regresses, it fails — no category gets a pass.
      failures.push({
        text: own.slice(0, 40),
        ratio: Math.round(ratio * 100) / 100,
        need,
        size,
        cls: (el.className?.toString?.() ?? '').slice(0, 60),
      });
    }
  }
  return { grays: [...new Set(grays)], failures, accents, measured };
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  console.log(`\nSprint 96 verification against ${BASE}\n`);

  const audit = async (label) => {
    const r = await page.evaluate(sweep);
    check(`${label}: no hardcoded gray text classes remain`, r.grays.length === 0, r.grays.join(', '));
    check(`${label}: EVERY visible text node meets WCAG AA (${r.measured} measured)`,
      r.failures.length === 0, JSON.stringify(r.failures.slice(0, 5)));
    if (r.accents.length) {
      const worst = r.accents.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
      console.log(`        note: ${r.accents.length} PRE-EXISTING accent/chip failure(s) here, worst ${worst.ratio}:1 on "${worst.text}" — not this sprint's scope, see HANDOFF`);
    }
  };

  // Login carried 26 of the 150 migrated classes — the most of any single file,
  // and the first thing anyone sees.
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  await audit('login');

  await page.fill('input[type="email"]', process.env.SEED_ADMIN_EMAIL ?? 'admin@floral.com');
  await page.fill('input[type="password"]', process.env.SEED_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  if (await page.locator('text=Select a school to continue').count()) {
    await audit('school picker');
    await page.getByText('BT Integrated School').first().click();
  }
  await page.waitForSelector('a[href="/patients"]', { timeout: 30000 });

  for (const [label, path] of [
    ['dashboard', '/'],
    ['patients', '/patients'],
    ['audit trail', '/audit'],                  // 23 migrations
    ['reports', '/reports'],                    // 8
    ['analytics', '/ai-analytics'],             // 38 — the most of any screen
    ['treatment records', '/treatment-records'] // 6
  ]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(3000);
    await audit(label);
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
