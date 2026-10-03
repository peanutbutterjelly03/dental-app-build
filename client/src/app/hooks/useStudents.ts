import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { usePendingWritesFor } from './useOfflineQueue';
import type { ApiSchool } from '../api/types';
import { surnameFirst } from '../utils/studentName';

export interface StudentRow {
  id: string;
  /** Surname-first ("Morales, Juan") — every list and heading reads this, so
   *  sorting on it is surname order for free. Parts kept below for forms. */
  name: string;
  lastName: string;
  firstName: string;
  middleName: string;
  birthdate: string;
  gender: string;
  grade: string;
  section: string;
  school: string;
  lastVisit: string | null;
  oralStatus: string;
  riskLevel: 'High' | 'Medium' | 'Low' | null;
  /** From the student's LATEST STUDENT_IPTR (consent is per school year).
   *  null means no IPTR exists yet — a different fact from "pending". */
  consentStatus: 'pending' | 'complete' | null;
  pending?: boolean;
}

export function useStudents() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  const pendingWrites = usePendingWritesFor('/students');

  const reload = useCallback(async () => {
    beginLoad();
    try {
      // The join that built these rows used to happen here, over six whole
      // collections fetched into the browser (Sprint 56b moved it to
      // /stats/student-rows). Eight components mount this hook, so at the
      // Chapter 1 scale of ~8,000 students it was the app's largest read.
      // `schools` is still fetched because the hook exposes it for the
      // optimistic pending-write rows below.
      const [rows, apiSchools] = await Promise.all([
        apiClient.get<StudentRow[]>('/stats/student-rows'),
        apiClient.get<ApiSchool[]>('/schools'),
      ]);

      setStudents(rows);
      setSchools(apiSchools);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
    } finally {
      endLoad();
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // A pending write disappearing from the queue means it just synced —
  // reload so the real server record (with its real _id) replaces the
  // optimistic one instead of leaving a gap until the next natural reload.
  const prevPendingCount = useRef(pendingWrites.length);
  useEffect(() => {
    if (pendingWrites.length < prevPendingCount.current) reload();
    prevPendingCount.current = pendingWrites.length;
  }, [pendingWrites.length, reload]);

  // Merge queued (not-yet-synced) student creations in as optimistic rows,
  // so staff see what they just entered while offline instead of it
  // silently disappearing until sync completes.
  const studentsWithPending = useMemo(() => {
    const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
    const pendingRows: StudentRow[] = pendingWrites.map((w) => {
      const body = w.body as Partial<{ full_name: string; last_name: string; first_name: string; middle_name: string; birthday: string; sex: string; grade_level: string; section: string; school_id: string }>;
      return {
        id: `pending-${w.id}`,
        name: surnameFirst(body) || '(pending sync)',
        lastName: body.last_name ?? '',
        firstName: body.first_name ?? '',
        middleName: body.middle_name ?? '',
        birthdate: body.birthday?.slice(0, 10) ?? '',
        gender: body.sex ?? '',
        grade: body.grade_level ?? '',
        section: body.section ?? '',
        school: schoolNameById.get(body.school_id ?? '') ?? 'Unknown School',
        lastVisit: null,
        oralStatus: 'Not Yet Screened',
        riskLevel: null,
        consentStatus: 'pending',
        pending: true,
      };
    });
    return [...pendingRows, ...students];
  }, [students, schools, pendingWrites]);

  return { students: studentsWithPending, loading, error, reload };
}
