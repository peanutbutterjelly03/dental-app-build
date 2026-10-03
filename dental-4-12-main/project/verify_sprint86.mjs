// Sprint 86 — the IPTR checkbox grid reader, exercised against the REAL form.
//
// Runs the ACTUAL module (imported through Vite's dev module graph) inside a
// browser, on the genuine blank IPTR page 1 the user supplied. Reimplementing
// the algorithm in Node would test nothing.
//
// The blank form is the sharpest test available: the grid must be FOUND (all
// its rules are printed) and yet ZERO ticks may be reported. A detector that
// hallucinates ink on an empty form would put invented medical history on a
// clinical record.
//
// Usage: node verify_sprint86.mjs [baseUrl] [pathToBlankIptrPage1Png]
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const PAGE1 = process.argv[3] || `${process.env.TEMP}/tcl_extract/iptr_p1_0.png`;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); } };

const run = async () => {
  const b64 = readFileSync(PAGE1).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForTimeout(1500);

  console.log(`\nSprint 86 verification against ${BASE}\n  form: ${PAGE1}\n`);

  const result = await page.evaluate(async (dataB64) => {
    const mod = await import('/src/app/utils/iptrCheckboxes.ts');
    const draw = (url) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        res(c);
      };
      img.onerror = rej;
      img.src = url;
    });
    const canvas = await draw('data:image/png;base64,' + dataB64);
    const scan = mod.readIptrCheckboxes(canvas);
    const ticked = Object.values(scan.ticks).flat().filter(Boolean).length;
    return {
      size: [canvas.width, canvas.height],
      confidence: scan.confidence,
      reason: scan.reason ?? null,
      years: Object.keys(scan.ticks).length,
      rowsPerYear: scan.ticks[1]?.length ?? 0,
      ticked,
      formRows: mod.IPTR_FORM_ROWS.length,
      unmapped: mod.UNMAPPED_ROWS,
    };
  }, b64);

  check('no page errors while running the module', errors.length === 0, errors.join(' | '));
  console.log(`  (image ${result.size.join('x')}, confidence ${result.confidence}${result.reason ? `, reason: ${result.reason}` : ''})`);

  // ── The grid must be located on the real printed form ────────────────────
  check('the Year 1-5 grid was FOUND on the real blank IPTR', result.confidence > 0, result.reason ?? '');

  if (result.confidence > 0) {
    check('all five Year columns were resolved', result.years === 5, `${result.years} columns`);
    check('one cell per form row', result.rowsPerYear === result.formRows, `${result.rowsPerYear} vs ${result.formRows}`);
    // THE important assertion.
    check('ZERO ticks reported on a BLANK form (no hallucinated findings)',
      result.ticked === 0, `${result.ticked} phantom ticks`);
  }

  // ── The unstorable rows are declared, not silently dropped ───────────────
  check('rows the data model cannot store are declared',
    result.unmapped.includes('Blood Disorders')
    && result.unmapped.includes('Orally Fit')
    && result.unmapped.includes('Dental Caries')
    && result.unmapped.includes('Completely Edentulous'),
    JSON.stringify(result.unmapped));

  // ── It must DECLINE on an image that is not the form ─────────────────────
  const declined = await page.evaluate(async () => {
    const mod = await import('/src/app/utils/iptrCheckboxes.ts');
    const c = document.createElement('canvas');
    c.width = 900; c.height = 900;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 900);
    ctx.fillStyle = '#000'; ctx.fillRect(100, 100, 400, 300); // a blob, not a table
    const s = mod.readIptrCheckboxes(c);
    return { confidence: s.confidence, reason: s.reason ?? null };
  });
  check('declines on an image that is not the form, with a reason',
    declined.confidence === 0 && !!declined.reason, JSON.stringify(declined));

  // ── Positive case: draw ticks into known cells, expect exactly those ─────
  // A detector that reports nothing always passes the blank-form test. This
  // marks three specific rows in the Year 2 column and requires those three,
  // and only those, to come back — proving it reads ink rather than ignoring
  // it, and that row identity is not off by one.
  const positive = await page.evaluate(async (dataB64) => {
    const mod = await import('/src/app/utils/iptrCheckboxes.ts');
    const draw = (url) => new Promise((res) => {
      const i = new Image();
      i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); res(c); };
      i.src = url;
    });
    const canvas = await draw('data:image/png;base64,' + dataB64);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width: w, height: h } = canvas;

    // Locate the grid the same way the module does, purely to place the marks.
    const px = ctx.getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < px.length; p += 4, i++) {
      dark[i] = (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]) < 170 ? 1 : 0;
    }
    const collapse = (a, g = 3) => { const o = []; let s = -1, q = -1; for (const i of a) { if (s === -1) { s = q = i; continue; } if (i - q <= g) { q = i; continue; } o.push(Math.round((s + q) / 2)); s = q = i; } if (s !== -1) o.push(Math.round((s + q) / 2)); return o; };
    const hAll = []; for (let y = 0; y < h; y++) { let c = 0; const b = y * w; for (let x = 0; x < w; x++) c += dark[b + x]; if (c > w * 0.45) hAll.push(y); }
    const coarse = collapse(hAll);
    const vAll = []; const t0 = coarse[0], t1 = coarse[coarse.length - 1];
    for (let x = 0; x < w; x++) { let c = 0; for (let y = t0; y < t1; y++) c += dark[y * w + x]; if (c > (t1 - t0) * 0.5) vAll.push(x); }
    const v = collapse(vAll);
    const probeX = v[v.length - 4];
    let bs = -1, bl = 0, rs = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dark[y * w + probeX] === 1;
      if (on && rs === -1) rs = y;
      if (!on && rs !== -1) { if (y - rs > bl) { bl = y - rs; bs = rs; } rs = -1; }
    }
    const hIn = collapse(hAll.filter((y) => y >= bs && y <= bs + bl));
    const bands = [];
    for (let i = 0; i < hIn.length - 1; i++) if (hIn[i + 1] - hIn[i] >= 8) bands.push([hIn[i], hIn[i + 1]]);
    const data = bands.slice(bands.length - mod.IPTR_FORM_ROWS.length);
    const edges = v.slice(-6);

    // Year 2 = the second year band. Mark rows 1, 5 and 20.
    const targets = [1, 5, 20];
    ctx.fillStyle = '#000';
    for (const r of targets) {
      const [y0, y1] = data[r];
      const x0 = edges[1], x1 = edges[2];
      ctx.fillRect(x0 + Math.round((x1 - x0) * 0.35), y0 + Math.round((y1 - y0) * 0.3), 40, 14);
    }
    const scan = mod.readIptrCheckboxes(canvas);
    const hits = [];
    mod.IPTR_FORM_ROWS.forEach((row, i) => {
      const yrs = mod.IPTR_YEARS.filter((y) => scan.ticks[y]?.[i]);
      if (yrs.length) hits.push({ i, label: row.label, years: [...yrs] });
    });
    return { targets, hits, confidence: scan.confidence };
  }, b64);

  check('marked cells are detected — exactly three findings',
    positive.hits.length === 3, JSON.stringify(positive.hits.map((x) => x.i)));
  check('the detected rows are the ones marked (no off-by-one)',
    JSON.stringify(positive.hits.map((x) => x.i)) === JSON.stringify(positive.targets),
    `${JSON.stringify(positive.hits.map((x) => x.i))} vs ${JSON.stringify(positive.targets)}`);
  check('each is attributed to Year 2, the column marked',
    positive.hits.every((x) => x.years.length === 1 && x.years[0] === 2),
    JSON.stringify(positive.hits.map((x) => x.years)));

  const tooSmall = await page.evaluate(async () => {
    const mod = await import('/src/app/utils/iptrCheckboxes.ts');
    const c = document.createElement('canvas');
    c.width = 100; c.height = 100;
    return mod.readIptrCheckboxes(c).confidence;
  });
  check('declines on a too-small image', tooSmall === 0, String(tooSmall));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
