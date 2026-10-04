import { describe, it, expect } from 'vitest';
import { isCacheablePath, referencesPendingRecord } from './readCache';

describe('isCacheablePath', () => {
  it('keeps the offline modules\' reads', () => {
    for (const p of ['/students/64b5f0c2a1b2c3d4e5f60718', '/student-iptrs?student_id=x', '/tooth-records?chart_id=a,b', '/stats/student-rows', '/stats/student-nav', '/stats/treatment-categories?year=1', '/auth/me', '/schools', '/dentists', '/appointments'])
      expect(isCacheablePath(p), p).toBe(true);
  });
  it('never keeps audit trails, accounts, reports, auth round trips or predictions', () => {
    for (const p of ['/audit', '/users', '/stats/reports-panels', '/stats/doh-report', '/stats/last-change', '/auth/refresh', '/auth/verify-password', '/predictions/x', '/school-year/status'])
      expect(isCacheablePath(p), p).toBe(false);
  });
});

describe('referencesPendingRecord', () => {
  it('spots a record that exists only on this device', () => {
    expect(referencesPendingRecord('/students/pending-7')).toBe(true);
    expect(referencesPendingRecord('/tooth-records?chart_id=pending-3')).toBe(true);
    expect(referencesPendingRecord('/students/64b5f0c2a1b2c3d4e5f60718')).toBe(false);
  });
});
