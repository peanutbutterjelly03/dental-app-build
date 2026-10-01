import { describe, it, expect } from 'vitest';
import { batchProblem, batchSummary, MAX_BATCH_FILES } from './ocrBatch';

describe('OCR batch rules', () => {
  it('accepts a single file of any kind, and many images or PDFs', () => {
    expect(batchProblem(['roster.xlsx'])).toBeNull();
    expect(batchProblem(['a.jpg', 'b.pdf', 'c.png'])).toBeNull();
  });

  it('a spreadsheet must be on its own', () => {
    expect(batchProblem(['a.jpg', 'roster.csv'])).toMatch(/spreadsheet is read on its own/);
  });

  it(`caps a batch at ${MAX_BATCH_FILES} files`, () => {
    expect(batchProblem(Array.from({ length: MAX_BATCH_FILES }, (_, i) => `${i}.jpg`))).toBeNull();
    expect(batchProblem(Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => `${i}.jpg`))).toMatch(/up to 20/);
  });

  it('summarises saved and skipped', () => {
    expect(batchSummary(['saved', 'skipped', 'saved'])).toBe('Batch done: 2 saved, 1 skipped.');
  });
});
