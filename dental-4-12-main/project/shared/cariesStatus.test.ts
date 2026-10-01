import { describe, it, expect } from 'vitest';
import { cariesStatus, conditionCounts } from './cariesStatus';
import { SOUND_PERMANENT, SOUND_TEMPORARY } from './rpcTracking';

describe('cariesStatus: the DOH "Yes or No - Caries Experience" group', () => {
  it('a treated tooth still counts as caries EXPERIENCE, but not as ACTIVE caries', () => {
    const s = cariesStatus({ F: 2 });
    expect(s.withCariesExperience).toBe(true);
    expect(s.inPermanentDentition).toBe(true);
    expect(s.inTemporaryTeeth).toBe(false);
    expect(s.withActiveCaries).toBe(false);
  });

  it('separates temporary (d/f) from permanent (D/M/F) experience', () => {
    const s = cariesStatus({ d: 1 });
    expect(s.inTemporaryTeeth).toBe(true);
    expect(s.inPermanentDentition).toBe(false);
    expect(s.withActiveCaries).toBe(true);
  });

  it('a tooth for extraction (x/X) alone is not caries experience', () => {
    const s = cariesStatus({ X: 1, x: 1 });
    expect(s.withCariesExperience).toBe(false);
    expect(s.withActiveCaries).toBe(false);
  });

  it('counts caries-free teeth only from teeth charted sound', () => {
    const s = cariesStatus({ D: 3, F: 2, [SOUND_PERMANENT]: 20, [SOUND_TEMPORARY]: 3 });
    expect(s.cariesFreeTeeth).toBe(23);
  });

  it('nothing charted is "not recorded" (null), never 0 caries-free teeth', () => {
    expect(cariesStatus({}).cariesFreeTeeth).toBeNull();
    expect(cariesStatus({ D: 0 }).cariesFreeTeeth).toBeNull();
  });

  it('charted with problems but no ✓ marks gives 0 caries-free, not a guess', () => {
    expect(cariesStatus({ D: 1 }).cariesFreeTeeth).toBe(0);
  });
});

describe('conditionCounts: ✓ is split into temporary and permanent by tooth number', () => {
  it('FDI 51+ counts as a sound temporary tooth, below 51 as permanent; √ is a tick too', () => {
    const c = conditionCounts([
      { tooth: 16, condition: '✓' }, { tooth: 11, condition: '√' }, { tooth: 54, condition: '✓' },
      { tooth: 46, condition: 'D' }, { tooth: 75, condition: '' },
    ]);
    expect(c).toEqual({ [SOUND_PERMANENT]: 2, [SOUND_TEMPORARY]: 1, D: 1 });
    expect(cariesStatus(c).cariesFreeTeeth).toBe(3);
  });
});
