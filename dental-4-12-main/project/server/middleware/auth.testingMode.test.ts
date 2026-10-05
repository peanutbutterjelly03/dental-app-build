// Testing mode (2026-10-01): OPEN_ACCESS_TESTING=true lets every SIGNED-IN user
// through requireRole; unset, RBAC is exactly as before. Sign-in stays required.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { requireRole } from './auth';

function run(role: string | null) {
  const req = { user: role ? { role } : undefined } as any;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
  const next = vi.fn();
  requireRole('dentist')(req, res, next);
  return { passed: next.mock.calls.length === 1, status: res.status.mock.calls[0]?.[0] };
}

afterEach(() => { delete process.env.OPEN_ACCESS_TESTING; });

describe('requireRole and the testing-mode switch', () => {
  it('normal: the wrong role is refused, the right role passes', () => {
    expect(run('school_admin')).toEqual({ passed: false, status: 403 });
    expect(run('dentist')).toEqual({ passed: true, status: undefined });
  });

  it('testing mode: any signed-in role passes', () => {
    process.env.OPEN_ACCESS_TESTING = 'true';
    expect(run('school_admin')).toEqual({ passed: true, status: undefined });
  });

  it('testing mode still requires sign-in', () => {
    process.env.OPEN_ACCESS_TESTING = 'true';
    expect(run(null)).toEqual({ passed: false, status: 401 });
  });

  it('only the exact value "true" turns it on', () => {
    process.env.OPEN_ACCESS_TESTING = 'yes';
    expect(run('school_admin')).toEqual({ passed: false, status: 403 });
  });
});
