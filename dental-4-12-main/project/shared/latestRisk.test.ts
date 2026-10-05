import { describe, it, expect } from 'vitest';
import { latestRisk } from './latestRisk';

describe('latestRisk (dashboard audit item 5)', () => {
  it('the newest visit wins, not the first school year', () => {
    const rows = [
      { risk_level: 'High', visit_date: '2025-08-10', validated_at: '2025-08-11' }, // last year, listed first
      { risk_level: 'Low', visit_date: '2026-08-12', validated_at: '2026-08-13' },
    ];
    expect(latestRisk(rows)?.risk_level).toBe('Low');
  });

  it('same visit date: the one validated last wins', () => {
    const rows = [
      { risk_level: 'Medium', visit_date: '2026-08-12', validated_at: '2026-08-20' },
      { risk_level: 'High', visit_date: '2026-08-12', validated_at: '2026-08-13' },
    ];
    expect(latestRisk(rows)?.risk_level).toBe('Medium');
  });

  it('a row with no visit date never beats one with a date', () => {
    expect(latestRisk([{ risk_level: 'Low', visit_date: '2026-01-05' }, { risk_level: 'High', visit_date: null }])?.risk_level).toBe('Low');
  });

  it('nothing validated is null', () => {
    expect(latestRisk([])).toBeNull();
  });
});
