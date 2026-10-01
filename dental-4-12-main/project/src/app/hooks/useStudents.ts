import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { usePendingWritesFor } from './useOfflineQueue';
import type { ApiSchool } from '../api/types';
import { surnameFirst } from '../utils/studentName';
import { cachedGet, refreshCached, invalidateCached } from '../utils/apiCache';

const STUDENT_ROWS_CACHE_KEY = '/stats/student-rows';

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
  /** The dentist-validated recommendation text from the same RiskStratification
   *  record `riskLevel` came from. Empty string when unassessed. */
  recommendation: string;
  /** The Risk chip on the Students list (2026-10-01): the SAME review status
   *  Risk Classification shows (shared `reviewSummary`). `level` is the
   *  dentist's once reviewed, the waiting suggestion's while it needs review.
   *  Absent on offline-queued rows. */
  riskReview?: {
    status: 'reviewed' | 'needs_review' | 'not_checked' | 'no_visit';
    level: 'High' | 'Medium' | 'Low' | null;
    reviewedAt: string | null;
  };
  /** This school year's treatment pipeline stage (user, 2026-09-28) --
   *  distinct from riskLevel/oralStatus's clinical severity. Resets to
   *  "For Oral Exam" each new school year even for a pupil who finished
   *  both RPC visits last year. */
  pipelineStatus: 'For Oral Exam' | 'For First Treatment' | 'For Second Treatment' | 'Completed';
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

  // The join that built these rows used to happen here, over six whole
  // collections fetched into the browser (Sprint 56b moved it to
  // /stats/student-rows). Eight components mount this hook, so at the
  // Chapter 1 scale of ~8,000 students it was the app's largest read.
  // `schools` is still fetched because the hook exposes it for the
  // optimistic pending-write rows below.
  //
  // Cached across mounts within the session (user, 2026-09-27): the
  // decrypt-heavy /stats/student-rows query was re-run in full on every
  // mount of every one of those eight components, even navigating back to a
  // page visited seconds ago. `force` is true for anything that just
  // mutated a student (add/edit/archive/import, or a queued write that
  // finally synced) and false for a plain page mount, which is happy to
  // reuse a still-fresh cache from wherever last warmed it.
  const runFetch = useCallback(async (force: boolean) => {
    beginLoad();
    try {
      const getRows = () => apiClient.get<StudentRow[]>(STUDENT_ROWS_CACHE_KEY);
      const [rows, apiSchools] = await Promise.all([
        force ? refreshCached(STUDENT_ROWS_CACHE_KEY, getRows) : cachedGet(STUDENT_ROWS_CACHE_KEY, getRows),
        apiClient.get<ApiSchool[]>('/schools'),
      ]);
      // The Dental Chart's Prev/Next nav (/stats/student-nav) reads the same
      // underlying roster -- a mutation here must invalidate that cache too,
      // or a chart opened next would still walk the pre-mutation nav order.
      if (force) invalidateCached('/stats/student-nav');

      setStudents(rows);
      setSchools(apiSchools);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
    } finally {
      endLoad();
    }
  }, []);

  const reload = useCallback(() => runFetch(true), [runFetch]);

  useEffect(() => {
    runFetch(false);
  }, [runFetch]);

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
        recommendation: '',
        pipelineStatus: 'For Oral Exam',
        consentStatus: 'pending',
        pending: true,
      };
    });
    return [...pendingRows, ...students];
  }, [students, schools, pendingWrites]);

  return { students: studentsWithPending, loading, error, reload };
}
