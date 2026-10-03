import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { usePendingWritesFor } from './useOfflineQueue';
import type { ApiUser, ApiSchool, ApiRole } from '../api/types';

export const ROLE_LABELS: Record<ApiRole, string> = {
  system_admin: 'System Admin',
  dentist: 'Dentist',
  dental_aide: 'Dental Aide',
  school_admin: 'School Admin',
  bho_staff: 'Barangay Health',
};

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: ApiRole;
  roleLabel: string;
  school: string;
  status: 'Active' | 'Inactive';
  twofaEnabled: boolean;
  pending?: boolean;
}

export function useUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  const pendingWrites = usePendingWritesFor('/users');

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const [apiUsers, apiSchools] = await Promise.all([
        apiClient.get<ApiUser[]>('/users'),
        apiClient.get<ApiSchool[]>('/schools'),
      ]);
      const schoolNameById = new Map(apiSchools.map((s) => [s._id, s.school_name]));
      setUsers(
        apiUsers.map((u) => ({
          id: u._id,
          name: u.full_name,
          email: u.email,
          role: u.role,
          roleLabel: ROLE_LABELS[u.role] ?? u.role,
          school: u.school_id ? (schoolNameById.get(u.school_id) ?? 'Unknown School') : 'All Schools',
          status: u.isArchived ? 'Inactive' : 'Active',
          twofaEnabled: u.twofa_enabled === true,
        })),
      );
      setSchools(apiSchools);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      endLoad();
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // A pending write disappearing from the queue means it just synced --
  // reload so the real server record (with its real _id) replaces the
  // optimistic one instead of leaving a gap until the next natural reload.
  const prevPendingCount = useRef(pendingWrites.length);
  useEffect(() => {
    if (pendingWrites.length < prevPendingCount.current) reload();
    prevPendingCount.current = pendingWrites.length;
  }, [pendingWrites.length, reload]);

  // Merge queued (not-yet-synced) user creations in as optimistic rows, so
  // System Admin sees the account they just created while offline instead
  // of it silently disappearing until sync completes.
  const usersWithPending = useMemo(() => {
    const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
    const pendingRows: UserRow[] = pendingWrites.map((w) => {
      const body = w.body as Partial<{ full_name: string; email: string; role: ApiRole; school_id: string }>;
      return {
        id: `pending-${w.id}`,
        name: body.full_name ?? '(pending sync)',
        email: body.email ?? '',
        role: body.role ?? 'dentist',
        roleLabel: body.role ? (ROLE_LABELS[body.role] ?? body.role) : 'Pending',
        school: body.school_id ? (schoolNameById.get(body.school_id) ?? 'Unknown School') : 'All Schools',
        status: 'Active',
        twofaEnabled: false,
        pending: true,
      };
    });
    return [...pendingRows, ...users];
  }, [users, schools, pendingWrites]);

  return { users: usersWithPending, schools, loading, error, reload };
}
