import { describe, expect, it } from 'vitest';
import { treatmentOptionsFor } from './treatmentRules';
import { treatmentCodes } from './treatmentCodes';

describe('treatmentOptionsFor', () => {
  it('follows the clinic table', () => {
    expect(treatmentOptionsFor('✓').codes).toEqual(['PFS']);
    expect(treatmentOptionsFor('D').codes).toEqual(['CO', 'GI', 'ART', 'TF', 'SDF1', 'SDF2']);
    expect(treatmentOptionsFor('M').codes).toEqual(['P']);
    expect(treatmentOptionsFor('X').codes).toEqual(['X', 'SDF1', 'SDF2']);
    expect(treatmentOptionsFor('S').codes).toEqual(['X']);
  });

  it('treats temporary-tooth letters and the old spellings the same as the permanent ones', () => {
    expect(treatmentOptionsFor('d')).toEqual(treatmentOptionsFor('D'));
    expect(treatmentOptionsFor('x')).toEqual(treatmentOptionsFor('X'));
    expect(treatmentOptionsFor('dx')).toEqual(treatmentOptionsFor('X'));
    expect(treatmentOptionsFor('un')).toEqual(treatmentOptionsFor('Un'));
    expect(treatmentOptionsFor('√')).toEqual(treatmentOptionsFor('✓'));
  });

  it('says why when there is nothing to chart', () => {
    for (const c of ['F', 'f', 'JC', 'jc', 'P', 'p']) expect(treatmentOptionsFor(c)).toMatchObject({ codes: [], none: expect.stringContaining('Treated already') });
    expect(treatmentOptionsFor('Un').none).toMatch(/not erupted/);
  });

  it('SDF itself can never be marked, only its two applications', () => {
    for (const c of ['D', 'X']) {
      const codes = treatmentOptionsFor(c).codes;
      expect(codes).not.toContain('SDF');
      expect(codes).toEqual(expect.arrayContaining(['SDF1', 'SDF2']));
    }
  });

  it('a root fragment is extracted (decided, not given in the clinic table)', () => {
    expect(treatmentOptionsFor('RF').codes).toEqual(['X']);
    expect(treatmentOptionsFor('rf').codes).toEqual(['X']);
  });

  it('a tooth with no condition, or an unknown one, offers nothing', () => {
    expect(treatmentOptionsFor('')).toEqual({ codes: [] });
    expect(treatmentOptionsFor(undefined)).toEqual({ codes: [] });
    expect(treatmentOptionsFor('ZZ')).toEqual({ codes: [] });
  });

  it('every code it offers exists in the treatment vocabulary', () => {
    const known = new Set(treatmentCodes.map((t) => t.code));
    for (const c of ['✓', 'D', 'M', 'F', 'X', 'Un', 'S', 'JC', 'P', 'RF']) {
      for (const code of treatmentOptionsFor(c).codes) expect(known.has(code)).toBe(true);
    }
  });
});
