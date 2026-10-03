// Sprint 87 — OCR corrections: dead anchors dropped, PhilHealth/4Ps added,
// page rotation handled.
//
// Runs the ACTUAL module (imported through Vite's dev module graph) in a real
// browser, because iptrOcr.ts needs canvas, tesseract.js and pdfjs — none of
// which a Node reimplementation would exercise.
//
// The three things worth testing here are NOT "does OCR work":
//   1. grade/section can no longer be produced at all (they are not on the form),
//   2. a PhilHealth number is read when present and REFUSED when the blank is
//      empty — capturing the words "Principal / Dependent" as an identifier
//      would stamp a wrong number onto a child's record,
//   3. a 180°-rotated page still reads. This is the silent-failure case: an
//      inverted page returns almost nothing rather than erroring, and the
//      checkbox grid identifies rows BY POSITION, so an uncorrected flip could
//      attribute ticks to the wrong conditions instead of failing.
//
// Usage: node verify_sprint87.mjs [baseUrl] [pathToBlankIptrPage1Png]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const PAGE1 = process.argv[3];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

if (!PAGE1) {
  console.error('Usage: node verify_sprint87.mjs <baseUrl> <path to blank IPTR page 1 png>');
  process.exit(2);
}

const run = async () => {
  const b64 = readFileSync(PAGE1).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForTimeout(1500);

  console.log(`\nSprint 87 verification against ${BASE}\n  form: ${PAGE1}\n`);

  const result = await page.evaluate(async (dataB64) => {
    const mod = await import('/src/app/utils/iptrOcr.ts');

    const load = (url) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    const toFile = (canvas, name) => new Promise((res) =>
      canvas.toBlob((blob) => res(new File([blob], name, { type: 'image/png' })), 'image/png'));

    const img = await load('data:image/png;base64,' + dataB64);
    const upright = document.createElement('canvas');
    upright.width = img.width; upright.height = img.height;
    upright.getContext('2d').drawImage(img, 0, 0);

    // The same page, physically inverted — exactly how page 2 is stored in the
    // supplied scan, and how a form photographed the wrong way round arrives.
    const flipped = document.createElement('canvas');
    flipped.width = img.width; flipped.height = img.height;
    const fx = flipped.getContext('2d');
    fx.translate(img.width, img.height);
    fx.rotate(Math.PI);
    fx.drawImage(img, 0, 0);

    // A synthetic personal-information block. Machine-set text is the only way
    // to assert an EXACT extracted value; the real blank form has nothing
    // written in these blanks to read.
    const synth = (philLine, fourPsLine) => {
      const c = document.createElement('canvas');
      c.width = 1700; c.height = 500;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#000'; x.font = '30px Arial';
      x.fillText("Patient's Name: Dela Cruz, Juan Miguel", 40, 80);
      x.fillText('Address: 123 Sampaguita Street', 40, 160);
      x.fillText('Contact #: 09171234567', 900, 160);
      x.fillText(philLine, 40, 240);
      x.fillText(fourPsLine, 900, 240);
      return c;
    };
    const filled = synth('Philhealth #: Principal / Dependent: 12-345678901-2', '4Ps/NHTS: 4PS00123456');
    const blankIds = synth('Philhealth #: Principal / Dependent: ________', '4Ps/NHTS: ________');

    const [u, f, filledRes, blankRes] = [
      await mod.extractIptrFields(await toFile(upright, 'p1.png')),
      await mod.extractIptrFields(await toFile(flipped, 'p1-rot.png')),
      await mod.extractIptrFields(await toFile(filled, 'ids.png')),
      await mod.extractIptrFields(await toFile(blankIds, 'ids-blank.png')),
    ];

    // The grid reader called DIRECTLY on an uncorrected upside-down page —
    // the guard has to hold on its own, not only behind iptrOcr's correction.
    const grid = await import('/src/app/utils/iptrCheckboxes.ts');
    const gridUpright = grid.readIptrCheckboxes(upright);
    const gridFlipped = grid.readIptrCheckboxes(flipped);
    const ticksOf = (s) => Object.values(s.ticks).flat().filter(Boolean).length;

    const slim = (r) => ({
      keys: Object.keys(r.fields),
      fields: r.fields,
      overallConfidence: r.overallConfidence,
      checkboxConfidence: r.checkboxConfidence,
      checkboxReason: r.checkboxReason ?? null,
      ticked: r.checkboxes.reduce((n, c) => n + c.years.length, 0),
      textLength: r.rawText.trim().length,
      hasTitle: /INDIVIDUAL\s+PATIENT\s+TREATMENT/i.test(r.rawText),
    });
    return {
      upright: slim(u), flipped: slim(f), filled: slim(filledRes), blank: slim(blankRes),
      gridUpright: { confidence: gridUpright.confidence, reason: gridUpright.reason ?? null, ticked: ticksOf(gridUpright) },
      gridFlipped: { confidence: gridFlipped.confidence, reason: gridFlipped.reason ?? null, ticked: ticksOf(gridFlipped) },
    };
  }, b64);

  const { upright, flipped, filled, blank, gridUpright, gridFlipped } = result;
  console.log(JSON.stringify(result, null, 2), '\n');

  // ── 1. The dead anchors are gone ────────────────────────────────────────
  check('upright: no `grade` key can be produced', !('grade' in upright.fields), JSON.stringify(upright.keys));
  check('upright: no `section` key can be produced', !('section' in upright.fields), JSON.stringify(upright.keys));
  check('synthetic filled: no grade/section either',
    !('grade' in filled.fields) && !('section' in filled.fields), JSON.stringify(filled.keys));

  // ── 2. PhilHealth / 4Ps ─────────────────────────────────────────────────
  check('filled: PhilHealth number read exactly', filled.fields.philhealthNumber === '12-345678901-2',
    String(filled.fields.philhealthNumber));
  check('filled: 4Ps ID read', (filled.fields.fourPsId || '').includes('4PS00123456'),
    String(filled.fields.fourPsId));
  check('blank IDs: PhilHealth REFUSED, not "Principal/Dependent"',
    !filled.fields.philhealthNumber || !blank.fields.philhealthNumber,
    String(blank.fields.philhealthNumber));
  check('real blank form: no PhilHealth invented', !blank.fields.philhealthNumber && !upright.fields.philhealthNumber,
    `${blank.fields.philhealthNumber} / ${upright.fields.philhealthNumber}`);
  check('filled: name still splits correctly',
    filled.fields.lastName === 'Dela' || /Cruz/i.test(String(filled.fields.lastName)) || filled.fields.firstName === 'Juan',
    JSON.stringify({ l: filled.fields.lastName, f: filled.fields.firstName }));

  // ── 3. Rotation ─────────────────────────────────────────────────────────
  check('upright: the form actually OCR\'d (baseline)', upright.hasTitle, `len ${upright.textLength}`);
  check('ROTATED page recovers the form title', flipped.hasTitle, `len ${flipped.textLength}`);
  check('ROTATED page yields comparable text volume (not a silent blank)',
    flipped.textLength > upright.textLength * 0.5, `${flipped.textLength} vs ${upright.textLength}`);

  // ── 4. Sprint 86 must still hold through the new code path ──────────────
  check('upright: checkbox grid still FOUND', upright.checkboxConfidence > 0, String(upright.checkboxReason));
  check('upright: ZERO ticks on the blank form', upright.ticked === 0, `${upright.ticked} ticks`);
  check('ROTATED: grid read on the corrected image, still zero ticks',
    flipped.checkboxConfidence > 0 && flipped.ticked === 0,
    `conf ${flipped.checkboxConfidence}, ${flipped.ticked} ticks, ${flipped.checkboxReason}`);

  // ── 5. The grid reader's own orientation guard, called directly ──────────
  // Before it existed, this exact call returned confidence 70 and 31 findings
  // on a BLANK form — ticks read in reverse row order.
  check('grid guard: upright page still accepted', gridUpright.confidence > 0 && gridUpright.ticked === 0,
    `conf ${gridUpright.confidence}, ${gridUpright.ticked} ticks, ${gridUpright.reason}`);
  check('grid guard: uncorrected upside-down page DECLINED', gridFlipped.confidence === 0,
    `conf ${gridFlipped.confidence}, ${gridFlipped.ticked} ticks`);
  check('grid guard: and it says why', /upside down/i.test(String(gridFlipped.reason)), String(gridFlipped.reason));

  // ── 6. Regressions the real form exposed while building this ────────────
  check('contact number is the NUMBER, not the label fragment "#"',
    filled.fields.contactNumber === '09171234567', String(filled.fields.contactNumber));
  check('blank form: no address invented from a speck', !upright.fields.address, String(upright.fields.address));
  check('blank form: no 4Ps ID invented from the form\'s own instruction line',
    !upright.fields.fourPsId, String(upright.fields.fourPsId));

  check('no uncaught page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
