import { describe, it, expect } from 'vitest';
import { canOpen } from './routeRoles';

describe('page guard (Sprint 163, SEC-34)', () => {
  it('the School Admin cannot open clinical screens by URL', () => {
    expect(canOpen('/dental-chart/abc123', 'school_admin')).toBe(false);
    expect(canOpen('/patients', 'school_admin')).toBe(false);
    expect(canOpen('/students/scan/review', 'school_admin')).toBe(false);
    expect(canOpen('/ai-analytics', 'bho_staff')).toBe(false);
    expect(canOpen('/notifications', 'school_admin')).toBe(false);
  });

  it('reports and the dashboard stay open to every role', () => {
    expect(canOpen('/', 'school_admin')).toBe(true);
    expect(canOpen('/reports', 'bho_staff')).toBe(true);
  });

  it('clinic roles keep their screens; admin-only screens stay admin-only', () => {
    expect(canOpen('/dental-chart/abc123', 'dental_aide')).toBe(true);
    expect(canOpen('/ai-analytics', 'dental_aide')).toBe(false);
    expect(canOpen('/audit', 'dentist')).toBe(false);
    expect(canOpen('/audit', 'system_admin')).toBe(true);
  });
});
