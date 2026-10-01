import { describe, it, expect } from 'vitest';
import { suggestTreatments, riskFindings, confidenceLabel } from './riskTreatments';

const teeth = [
  { tooth: 46, condition: 'D' },
  { tooth: 16, condition: 'D' },
  { tooth: 75, condition: 'd' },
  { tooth: 36, condition: 'F' },
  { tooth: 11, condition: 'sound_permanent' },
];

describe('suggestTreatments (rules from the classmate design, user-approved)', () => {
  it('High risk: FV for the whole mouth, PF per D tooth, SDF per d tooth, in that order', () => {
    expect(suggestTreatments(teeth, 'High').map((t) => `${t.code}:${t.tooth ?? 'mouth'}`))
      .toEqual(['FV:mouth', 'PF:16', 'PF:46', 'SDF:75']);
  });

  it('Low risk: no Fluoride Varnish, but decayed teeth are still offered', () => {
    expect(suggestTreatments(teeth, 'Low').map((t) => t.code)).toEqual(['PF', 'PF', 'SDF']);
  });

  it('follows the CONFIRMED level: changing High to Low in step 2 drops FV in step 3', () => {
    expect(suggestTreatments(teeth, 'High').some((t) => t.code === 'FV')).toBe(true);
    expect(suggestTreatments(teeth, 'Low').some((t) => t.code === 'FV')).toBe(false);
  });

  it('a filled or sound tooth is never offered a treatment', () => {
    const codes = suggestTreatments(teeth, 'Medium').filter((t) => t.tooth === 36 || t.tooth === 11);
    expect(codes).toEqual([]);
  });

  it('gives the reason in the words of her design', () => {
    expect(suggestTreatments([{ tooth: 46, condition: 'D' }], 'High')[1].why).toBe('Tooth 46 is marked D (decayed)');
  });
});

describe('riskFindings: real facts only, labelled Findings not Reasons', () => {
  it('lists decayed teeth with their numbers, filled count and diet', () => {
    expect(riskFindings({ teeth, sugarBeverages: true, gingivitis: false, calculus: false })).toEqual([
      '2 decayed permanent teeth (46, 16)',
      '1 decayed baby tooth (75)',
      '1 filled tooth from earlier visits',
      'Takes sugar-sweetened drinks or food (dietary form)',
    ]);
  });

  it('says nothing it has no record of', () => {
    expect(riskFindings({ teeth: [], sugarBeverages: false, gingivitis: false, calculus: false })).toEqual([]);
  });
});

describe('confidenceLabel', () => {
  it('maps the model probability to plain words', () => {
    expect(confidenceLabel(0.91)).toBe('Very sure');
    expect(confidenceLabel(0.8)).toBe('Very sure');
    expect(confidenceLabel(0.7)).toBe('Fairly sure');
    expect(confidenceLabel(0.4)).toBe('Not sure');
    expect(confidenceLabel(null)).toBeNull();
  });
});
