// O2 (2026-10-01): the OCR fixes, pinned with the values the classmate's three
// test images actually produced (clinic Patient Information Sheet, a web-form
// screenshot, and a two-page IPTR). Each case below was a wrong or blank field
// before the fix.

import { describe, it, expect } from 'vitest';
import { ocrTextRules as r } from './iptrOcr';
import { readTickGroup, type PixelSource, type LabelBox } from './iptrTickBoxes';

describe('Sex', () => {
  it('a stray "*" after the caption is blank, not the value (it blocked the tick-box reader)', () => {
    expect(r.normalizeSex('*')).toBe('');
  });
  it('reads the IPTR "M ___ F ___" line by which letter carries the tick glyph', () => {
    expect(r.normalizeSex('M Fv')).toBe('Female');
    expect(r.normalizeSex('Mv F')).toBe('Male');
    expect(r.normalizeSex('M F')).toBe('');
    expect(r.normalizeSex('Mv Fv')).toBe('');
  });
});

describe('text fields', () => {
  it('a greyed example phone number is not a number', () => {
    expect(r.normalizePhone('09XX XXX XXXX')).toBe('');
    expect(r.normalizePhone('0912-345-6789')).toBe('0912-345-6789');
  });
  it('grade takes the first real grade, not the helper text printed under the box', () => {
    expect(r.normalizeGradeText('Grade 1 v Grade choices: Kinder, Grade 1, Grade 2,')).toBe('Grade 1');
    expect(r.normalizeGradeText('Kinder')).toBe('Kinder');
  });
  it('the IPTR name line with a trailing initial is Surname / First / M.I.', () => {
    expect(r.splitName('Reyes Mikaela S.')).toEqual({ lastName: 'Reyes', firstName: 'Mikaela', middleName: 'S.' });
  });
  it('the medical-history half of a spread does not rank as the identity page', () => {
    expect(r.identityScore('Lagda at Pangalan ng Pasyente For Minor: Lagda ng Magulang')).toBe(0);
    expect(r.identityScore('Name: Reyes Mikaela s.\nDateof Birth: Jan 11, 2019 Age: 7\nSex: M Fv\nAddress Barangay Tanyag')).toBeGreaterThanOrEqual(2);
  });
});

// A white page with a box outline left of each label, and a tick drawn in one.
function page(ticked: string | null, labels: Record<string, LabelBox>): PixelSource {
  const width = 400, height = 60;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => { const p = (y * width + x) * 4; data[p] = data[p + 1] = data[p + 2] = 0; };
  for (const [name, l] of Object.entries(labels)) {
    const bx1 = l.x0 - 12, bx0 = bx1 - 26, by0 = 18, by1 = 44;
    for (let x = bx0; x <= bx1; x++) { ink(x, by0); ink(x, by1); }
    for (let y = by0; y <= by1; y++) { ink(bx0, y); ink(bx1, y); }
    if (name === ticked) for (let i = 0; i < 18; i++) { ink(bx0 + 4 + i, by0 + 4 + i); ink(bx0 + 5 + i, by0 + 4 + i); ink(bx0 + 4 + i, by1 - 4 - i); }
  }
  return { width, height, data };
}

describe('tick boxes', () => {
  // Label boxes of DIFFERENT heights beside identical boxes: the case that
  // used to put the measurement on the box border and decline.
  const labels = {
    Male: { text: 'Male', x0: 120, x1: 160, y0: 23, y1: 39 },
    Female: { text: 'Female', x0: 300, x1: 360, y0: 16, y1: 46 },
  };
  it('picks the ticked box even when the labels are different heights', () => {
    expect(readTickGroup(page('Female', labels), labels).choice).toBe('Female');
    expect(readTickGroup(page('Male', labels), labels).choice).toBe('Male');
  });
  it('declines when nothing is ticked', () => {
    expect(readTickGroup(page(null, labels), labels).choice).toBeNull();
  });
});
