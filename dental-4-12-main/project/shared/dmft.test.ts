import { describe, it, expect } from 'vitest';
import { summarizeDmft, computeDMFT } from './dmft';

describe('DMFT dashboard summary (dashboard audit item 15)', () => {
  it('uses the chart rule: permanent D/M/F/X, primary d/m/f/x', () => {
    const r = computeDMFT({ 16: { condition: 'D' }, 36: { condition: 'F' }, 55: { condition: 'd' }, 11: { condition: '✓' } });
    expect(r.T).toBe(2);
    expect(r.t).toBe(1);
  });

  it('median and quartiles over charted pupils only', () => {
    const s = summarizeDmft([{ T: 0, t: 0 }, { T: 1, t: 2 }, { T: 2, t: 0 }, { T: 4, t: 1 }, { T: 8, t: 0 }]);
    expect(s.charted).toBe(5);
    expect(s.permanent).toEqual({ mean: 3, median: 2, q1: 1, q3: 4, max: 8 });
    expect(s.primary?.median).toBe(0);
    expect(s.primary?.mean).toBe(0.6); // (0 + 2 + 0 + 1 + 0) / 5, the DOH-style average
  });

  it('caries experience is DMFT + dmft above 0', () => {
    expect(summarizeDmft([{ T: 0, t: 0 }, { T: 0, t: 3 }, { T: 1, t: 0 }]).withCariesExperience).toBe(2);
  });

  it('no charted pupils gives nulls, not zeros', () => {
    const s = summarizeDmft([]);
    expect(s.charted).toBe(0);
    expect(s.permanent).toBeNull();
    expect(s.primary).toBeNull();
  });
});
