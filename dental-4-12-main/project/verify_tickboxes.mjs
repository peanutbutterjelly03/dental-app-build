// Verifies iptrTickBoxes.ts on synthetic pixels (no OCR, no canvas needed).
import { readIptrTickBoxes } from './src/app/utils/iptrTickBoxes.ts';
const W = 600, H = 100;
const mk = () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
const rect = (px, x0, y0, x1, y1, v = 0) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * W + x) * 4; px.data[p] = px.data[p+1] = px.data[p+2] = v; } };
const outline = (px, x, y, s) => { rect(px, x, y, x + s, y + 2); rect(px, x, y + s - 2, x + s, y + s); rect(px, x, y, x + 2, y + s); rect(px, x + s - 2, y, x + s, y + s); };
// label height 20 -> box ~22 wide sitting 5px left of label
const label = (text, x0) => ({ text, x0, x1: x0 + 50, y0: 40, y1: 60 });
const sex = [label('Male', 100), label('Female', 300)];
const boxAt = (px, lx) => outline(px, lx - 5 - 22, 39, 22);
const tick = (px, lx) => rect(px, lx - 5 - 18, 43, lx - 5 - 4, 57); // filled mark inside
let fail = 0;
const t = (name, ok) => { console.log(ok ? 'PASS' : 'FAIL', name); if (!ok) fail++; };

let a = mk(); boxAt(a, 100); boxAt(a, 300); tick(a, 300);
t('Female ticked', readIptrTickBoxes(a, sex).gender?.value === 'Female');
let b = mk(); boxAt(b, 100); boxAt(b, 300); tick(b, 100);
t('Male ticked', readIptrTickBoxes(b, sex).gender?.value === 'Male');
let c = mk(); boxAt(c, 100); boxAt(c, 300);
t('blank -> declines', readIptrTickBoxes(c, sex).gender === undefined);
let d = mk(); boxAt(d, 100); boxAt(d, 300); tick(d, 100); tick(d, 300);
t('both ticked -> declines', readIptrTickBoxes(d, sex).gender === undefined);
t('missing Female label -> declines', readIptrTickBoxes(a, [sex[0]]).gender === undefined);
t('labels on different lines -> declines', readIptrTickBoxes(a, [sex[0], { ...sex[1], y0: 80, y1: 98 }]).gender === undefined);

const ph = [label('None', 100), label('Principal', 250), label('Dependent', 400)];
let e = mk(); [100, 250, 400].forEach((x) => boxAt(e, x)); tick(e, 250);
t('Principal ticked', readIptrTickBoxes(e, ph).philhealthStatus?.value === 'Principal');
let f = mk(); [100, 250, 400].forEach((x) => boxAt(f, x)); tick(f, 400);
const r = readIptrTickBoxes(f, [...sex, ...ph]);
t('Dependent ticked + sex blank independent', r.philhealthStatus?.value === 'Dependent' && r.gender === undefined);
// light tick (thin stroke) still beats outline-only
let g = mk(); [100, 250, 400].forEach((x) => boxAt(g, x));
for (let i = 0; i < 12; i++) rect(g, 250 - 5 - 18 + i, 43 + i, 250 - 5 - 18 + i + 2, 43 + i + 2);
console.log('thin diagonal:', JSON.stringify(readIptrTickBoxes(g, ph)));
process.exit(fail ? 1 : 0);
