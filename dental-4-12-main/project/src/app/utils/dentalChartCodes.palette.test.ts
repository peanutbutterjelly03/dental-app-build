import { describe, expect, it } from 'vitest';
import { conditionCodes, paletteConditionCodes, paletteMoreConditionCodes } from './dentalChartCodes';

describe('palette split', () => {
  it('puts RF/rf (Root Fragment) on the main row, after X/x', () => {
    expect(paletteConditionCodes.map((c) => c.code)).toEqual(['✓', 'D', 'M', 'F', 'X', 'RF']);
    expect(paletteConditionCodes.at(-1)).toMatchObject({ label: 'Root Fragment', perm: 'RF', temp: 'rf' });
    expect(paletteMoreConditionCodes.map((c) => c.code)).toEqual(['Un', 'S', 'JC', 'P']);
  });

  it('does not change the vocabulary or its order, which the Legend and the reports read', () => {
    expect(conditionCodes.map((c) => c.code)).toEqual(['✓', 'D', 'M', 'F', 'X', 'Un', 'S', 'JC', 'P', 'RF']);
  });
});
