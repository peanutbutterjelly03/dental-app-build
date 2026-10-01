import { describe, it, expect } from 'vitest';
import { tickBodies, tickKind, tickKey, defaultTickYear } from './ocrTickFindings';
import type { IptrCheckboxFinding } from './iptrOcrShared';

const f = (label: string, section: IptrCheckboxFinding['section'], field: string | null, years: number[], text = false): IptrCheckboxFinding =>
  ({ label, section, field, years, text });

// Shaped like a real 2026 sheet: oral rows ticked in Year 1, plus rows that
// must never be written as `true`.
const findings = [
  f('Gingivitis', 'oral', 'gingivitis', [1]),
  f('Calculus', 'oral', 'calculus', [1]),
  f('Dental Caries', 'oral', null, [1]),
  f('Thumbsucking', 'dietary', 'thumb_sucking', [1, 2]),
  f('Allergies (Please specify)', 'medical', 'allergies', [1], true),
  f('Tattoo', 'medical', 'tattoo', [2]),
];

describe('tick findings to records', () => {
  it('saves only ACCEPTED storable ticks in the chosen year', () => {
    const accepted = new Set(['oral:Gingivitis', 'dietary:Thumbsucking', 'medical:Tattoo']);
    expect(tickBodies(findings, 1, accepted)).toEqual({ oral: { gingivitis: true }, dietary: { thumb_sucking: true } });
    expect(tickBodies(findings, 2, accepted)).toEqual({ dietary: { thumb_sucking: true }, medical: { tattoo: true } });
  });

  it('nothing accepted means no record at all, not an all-"Hindi" one', () => {
    expect(tickBodies(findings, 1, new Set())).toEqual({});
  });

  it('a text row or an unstorable row is never written, even if accepted', () => {
    const accepted = new Set(['medical:Allergies (Please specify)', 'oral:Dental Caries']);
    expect(tickBodies(findings, 1, accepted)).toEqual({});
    expect(tickKind(findings[4])).toBe('text');
    expect(tickKind(findings[2])).toBe('unstorable');
  });

  it('the two "Others" rows have different keys', () => {
    expect(tickKey(f('Others (Please specify)', 'medical', 'others', [1], true)))
      .not.toBe(tickKey(f('Others (Please specify)', 'oral', 'others', [1], true)));
  });

  it('defaults to the latest ticked year, Year 1 when nothing is ticked', () => {
    expect(defaultTickYear(findings)).toBe(2);
    expect(defaultTickYear([])).toBe(1);
  });
});
