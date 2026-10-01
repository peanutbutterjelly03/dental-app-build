// O2b (2026-10-01): the Year 1-5 grid reader, on a synthetic copy of the
// printed table. The real form puts the "Dietary Habits…" and "Oral Health
// Condition" headings in RULED ROWS of their own; reading the last 31 rows as
// the 31 conditions shifted every row above a heading (a Thumbsucking tick was
// reported as "Nail Biting"). Also verified in the browser on the genuine blank
// IPTR PDF: zero ticks, and six drawn ticks returned on exactly their rows.

import { describe, it, expect } from 'vitest';
import { readIptrCheckboxes, IPTR_FORM_ROWS } from './iptrCheckboxes';

const W = 1028, H = 1300;
// Column rules as measured on the real form at the app's PDF render size:
// label column, then Year 1-5.
const COLS = [21, 340, 472, 605, 738, 870, 1002];
// Printed rows from the top: header, DATE EXAMINED, "Medical History" heading,
// 14 medical, heading, 7 dietary, heading, 10 oral.
const LAYOUT = ['header', 'date', 'heading', ...Array(14).fill('m'), 'heading', ...Array(7).fill('d'), 'heading', ...Array(10).fill('o')];
const TOP = 384, ROW = 18;

type Tick = { year: number; label: string; section: 'medical' | 'dietary' | 'oral' };

function sheet(ticks: Tick[]) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => { const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0; };
  const bottom = TOP + LAYOUT.length * ROW;
  for (let i = 0; i <= LAYOUT.length; i++) for (let x = COLS[0]; x <= COLS[6]; x++) ink(x, TOP + i * ROW);
  for (const x of COLS) for (let y = TOP; y <= bottom; y++) ink(x, y);
  // A tick is a short stroke in the middle of its cell.
  // The printed band of a condition: its position among the non-heading rows.
  const bandOf = (t: Tick) => {
    const row = IPTR_FORM_ROWS.findIndex((r) => r.label === t.label && r.section === t.section);
    let seen = -1;
    for (let b = 0; b < LAYOUT.length; b++) if (['m', 'd', 'o'].includes(LAYOUT[b]) && ++seen === row) return b;
    throw new Error(`no band for ${t.label}`);
  };
  for (const t of ticks) {
    const b = bandOf(t);
    const x0 = COLS[t.year], y0 = TOP + b * ROW;
    // A 3 px pen check mark: a short leg down, a long leg up.
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 9; i++) ink(x0 + 40 + i + k, y0 + 6 + i);
      for (let i = 0; i < 26; i++) ink(x0 + 48 + i + k, y0 + 14 - Math.floor(i * 0.4));
    }
  }
  return { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) } as unknown as HTMLCanvasElement;
}

function found(canvas: HTMLCanvasElement) {
  const r = readIptrCheckboxes(canvas);
  const out: string[] = [];
  for (const [year, col] of Object.entries(r.ticks)) col.forEach((t, i) => { if (t) out.push(`Y${year}:${IPTR_FORM_ROWS[i].label}`); });
  return { confidence: r.confidence, out: out.sort() };
}

describe('Year 1-5 grid', () => {
  it('reads the table and invents nothing on a blank form', () => {
    const r = found(sheet([]));
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.out).toEqual([]);
  });

  it('returns each tick on its own row, across all three sections', () => {
    const r = found(sheet([
      { year: 1, label: 'Dental Caries', section: 'oral' },
      { year: 1, label: 'Calculus', section: 'oral' },
      { year: 3, label: 'Thumbsucking', section: 'dietary' },
      { year: 5, label: 'Allergies (Please specify)', section: 'medical' },
    ]));
    expect(r.out).toEqual([
      'Y1:Calculus',
      'Y1:Dental Caries',
      'Y3:Thumbsucking',
      'Y5:Allergies (Please specify)',
    ]);
  });
});
