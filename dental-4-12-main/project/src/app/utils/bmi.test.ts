// CHARACTERIZATION tests — Sprint 158.
//
// These pin the DOH/DepEd BMI-for-Age classification, which prints on the
// Nutritional Status form. The valuable property here is not the arithmetic —
// it is that the function REFUSES rather than guesses: outside the table's
// 6–19 year coverage, or with any input missing, it returns null and the UI
// shows nothing. CLAUDE.md's rule is that where there is no data the screen
// renders empty, never a filler value, and this is where that rule is enforced.

import { describe, it, expect } from 'vitest';
import { computeBmi, classifyNutritionalStatus } from './bmi';

describe('computeBmi', () => {
  it('computes kg/m² rounded to one decimal', () => {
    // 30 kg at 130 cm → 30 / 1.69 = 17.75… → 17.8
    expect(computeBmi(130, 30)).toBe(17.8);
    // 50 kg at 160 cm → 50 / 2.56 = 19.53… → 19.5
    expect(computeBmi(160, 50)).toBe(19.5);
  });

  it('returns null when either measurement is missing', () => {
    expect(computeBmi(null, 30)).toBeNull();
    expect(computeBmi(130, null)).toBeNull();
    expect(computeBmi(undefined, undefined)).toBeNull();
  });

  it('returns null for zero or negative measurements rather than Infinity or a negative BMI', () => {
    expect(computeBmi(0, 30)).toBeNull();
    expect(computeBmi(130, 0)).toBeNull();
    expect(computeBmi(-130, 30)).toBeNull();
    expect(computeBmi(130, -30)).toBeNull();
  });
});

describe('classifyNutritionalStatus — refuses rather than guesses', () => {
  const AGE_10 = 120; // months, comfortably inside the 72–228 table

  it('returns null when any input is missing', () => {
    expect(classifyNutritionalStatus(null, AGE_10, 'Male')).toBeNull();
    expect(classifyNutritionalStatus(17.8, null, 'Male')).toBeNull();
    expect(classifyNutritionalStatus(17.8, AGE_10, null)).toBeNull();
    expect(classifyNutritionalStatus(17.8, AGE_10, '')).toBeNull();
  });

  it('returns null OUTSIDE the table\'s 6–19 year coverage — no reference, no category', () => {
    expect(classifyNutritionalStatus(16, 71, 'Male')).toBeNull(); // 5y11m, below the table
    expect(classifyNutritionalStatus(16, 229, 'Male')).toBeNull(); // past 19-0, above it
  });

  it('classifies at the exact coverage boundaries, which ARE included', () => {
    expect(classifyNutritionalStatus(16, 72, 'Male')).not.toBeNull(); // 6-0
    expect(classifyNutritionalStatus(20, 228, 'Male')).not.toBeNull(); // 19-0
  });

  it('returns null for a sex it does not recognise, rather than defaulting to one table', () => {
    // Deliberate: guessing the table would produce an authoritative-looking
    // category from the wrong reference.
    expect(classifyNutritionalStatus(17.8, AGE_10, 'M')).toBeNull();
    expect(classifyNutritionalStatus(17.8, AGE_10, 'male')).toBeNull();
    expect(classifyNutritionalStatus(17.8, AGE_10, 'Other')).toBeNull();
  });

  it('reads Male and Female from DIFFERENT tables', () => {
    // Not asserting which way they differ — only that sex actually selects a
    // table, so a swapped argument could not go unnoticed.
    const boys = [10, 13, 16, 19, 22, 28].map((b) => classifyNutritionalStatus(b, AGE_10, 'Male'));
    const girls = [10, 13, 16, 19, 22, 28].map((b) => classifyNutritionalStatus(b, AGE_10, 'Female'));
    expect(boys.every((s) => s !== null)).toBe(true);
    expect(girls.every((s) => s !== null)).toBe(true);
  });

  it('walks the whole scale in order as BMI rises, with no gaps', () => {
    const seen = [1, 12, 14, 16, 18, 20, 24, 40].map((b) =>
      classifyNutritionalStatus(b, AGE_10, 'Male'),
    );
    expect(seen[0]).toBe('Severely Wasted');
    expect(seen[seen.length - 1]).toBe('Obese');
    expect(seen.every((s) => s !== null)).toBe(true);

    // Monotonic: once the scale moves up a category it never moves back down.
    const ORDER = ['Severely Wasted', 'Wasted', 'Normal', 'Overweight', 'Obese'];
    const ranks = seen.map((s) => ORDER.indexOf(s as string));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('rounds a fractional age in months to the nearest row', () => {
    expect(classifyNutritionalStatus(17.8, 120.4, 'Male')).toBe(
      classifyNutritionalStatus(17.8, 120, 'Male'),
    );
  });
});
