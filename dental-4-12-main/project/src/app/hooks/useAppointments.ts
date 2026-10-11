import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { usePendingWritesFor } from './useOfflineQueue';
import { toLocalDateString, toLocalTimeString } from '../utils/localDate';
import type { ApiAppointment, ApiStudent, ApiDentist, ApiSchool } from '../api/types';
import { surnameFirst } from '../utils/studentName';

export interface SessionStudent {
  id: string;
  name: string;
  gender: string;
  age: number;
  riskLevel: string | null;
  /** The underlying APPOINTMENT this pupil holds in the session (Sprint 109).
   *  Carried explicitly rather than read positionally out of
   *  `appointmentIds` — the arrays happen to be built in step today, and a
   *  note written against the wrong pupil is exactly the class of bug that
   *  kind of coupling produces. */
  appointmentId: string;
  /** Remark on that appointment; '' when unset. */
  notes: string;
}

export interface AppointmentSession {
  id: string; // synthetic group key
  appointmentIds: string[]; // underlying real Appointment _ids, for status updates
  date: string;
  time: string;
  school: string;
  grade: string;
  section: string;
  studentCount: number;
  type: string;
  status: string;
  dentist: string;
  students: SessionStudent[];
  pending?: boolean;
}

function calculateAge(birthdate: string) {
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function buildSessions(
  appointments: ApiAppointment[],
  studentById: Map<string, ApiStudent>,
  schoolNameById: Map<string, string>,
  dentistNameById: Map<string, string>,
): AppointmentSession[] {
  const groups = new Map<string, AppointmentSession>();
  for (const appt of appointments) {
    const student = studentById.get(appt.student_id);
    if (!student) continue;

    const dt = new Date(appt.appointment_datetime);
    const date = toLocalDateString(dt);
    const time = toLocalTimeString(dt);
    const school = schoolNameById.get(student.school_id) ?? 'Unknown School';
    const key = [date, time, school, student.grade_level, student.section, appt.appointment_type, appt.dentist_id, appt._id.startsWith('pending-') ? appt._id : ''].join('|');

    let group = groups.get(key);
    if (!group) {
      group = {
        id: key,
        appointmentIds: [],
        date,
        time,
        school,
        grade: student.grade_level,
        section: student.section,
        studentCount: 0,
        type: appt.appointment_type,
        status: appt.status,
        dentist: dentistNameById.get(appt.dentist_id) ?? 'Unassigned',
        students: [],
        pending: appt._id.startsWith('pending-'),
      };
      groups.set(key, group);
    }

    group.appointmentIds.push(appt._id);
    group.studentCount++;
    group.students.push({
      id: student._id,
      name: surnameFirst(student),
      gender: student.sex,
      age: calculateAge(student.birthday),
      riskLevel: null,
      appointmentId: appt._id,
      notes: appt.notes ?? '',
    });
  }
  return Array.from(groups.values());
}

/** Ids per `/students?_id=` request. Mirrors MAX_FILTER_IDS in
 *  server/routes/crudFactory.ts — the server rejects anything above it, and the
 *  cap is there so a crafted query cannot become an unbounded `$in`. Raising it
 *  would reopen exactly that, so a wide date range chunks instead. */
const STUDENT_ID_CHUNK = 200;

/** Fetch only the students an appointment set actually references, in capped
 *  batches. This used to be a bare `/students` — the whole collection, ~8,000
 *  records at the Chapter 1 scale, pulled to resolve a few dozen names. */
async function fetchStudentsByIds(ids: string[]): Promise<ApiStudent[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += STUDENT_ID_CHUNK) {
    chunks.push(ids.slice(i, i + STUDENT_ID_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) => apiClient.get<ApiStudent[]>(`/students?_id=${chunk.join(',')}`)),
  );
  return results.flat();
}

/** Inclusive instants bounding which appointments are loaded. `from` omitted
 *  means "everything before `to`" — the explicit "show earlier" case. */
export interface AppointmentWindow {
  from?: Date;
  to: Date;
}

export function useAppointments(window: AppointmentWindow) {
  const [appointments, setAppointments] = useState<ApiAppointment[]>([]);
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  const [dentists, setDentists] = useState<ApiDentist[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);
  const pendingWrites = usePendingWritesFor('/appointments');

  // Depend on the instants, not the object: callers build the window inline on
  // every render, so an object identity dependency would refetch in a loop.
  const fromMs = window.from?.getTime();
  const toMs = window.to.getTime();

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const params = new URLSearchParams({ to: new Date(toMs).toISOString() });
      if (fromMs !== undefined) params.set('from', new Date(fromMs).toISOString());

      // Appointments first: the students to fetch are whichever ones this
      // bounded set references, so the two cannot go in parallel.
      const apiAppointments = await apiClient.get<ApiAppointment[]>(`/appointments?${params}`);
      const studentIds = [...new Set(apiAppointments.map((a) => a.student_id))];

      // Dentists and schools stay whole: 1 dentist and 3 schools, and they are
      // reference data that does not grow with student count.
      const [apiStudents, apiDentists, apiSchools] = await Promise.all([
        studentIds.length ? fetchStudentsByIds(studentIds) : Promise.resolve([]),
        apiClient.get<ApiDentist[]>('/dentists'),
        apiClient.get<ApiSchool[]>('/schools'),
      ]);

      setAppointments(apiAppointments);
      setStudents(apiStudents);
      setSchools(apiSchools);
      setDentists(apiDentists);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
    } finally {
      endLoad();
    }
  }, [fromMs, toMs]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A pending write disappearing from the queue means it just synced.
  const prevPendingCount = useRef(pendingWrites.length);
  useEffect(() => {
    if (pendingWrites.length < prevPendingCount.current) reload();
    prevPendingCount.current = pendingWrites.length;
  }, [pendingWrites.length, reload]);

  const sessions = useMemo(() => {
    const studentById = new Map(students.map((s) => [s._id, s]));
    const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
    const dentistNameById = new Map(dentists.map((d) => [d._id, `Dr. ${d.first_name} ${d.last_name}`]));

    const pendingAppointments: ApiAppointment[] = pendingWrites.map((w) => {
      const body = w.body as Partial<ApiAppointment>;
      return {
        _id: `pending-${w.id}`,
        student_id: body.student_id ?? '',
        dentist_id: body.dentist_id ?? '',
        appointment_datetime: body.appointment_datetime ?? new Date().toISOString(),
        status: body.status ?? 'scheduled',
        appointment_type: body.appointment_type ?? 'checkup',
        requires_followup: body.requires_followup ?? false,
        parental_supervision_required: body.parental_supervision_required ?? false,
        isArchived: false,
      };
    });

    return buildSessions([...appointments, ...pendingAppointments], studentById, schoolNameById, dentistNameById);
  }, [appointments, students, schools, dentists, pendingWrites]);

  const updateSessionStatus = useCallback(async (session: AppointmentSession, status: string) => {
    await Promise.all(session.appointmentIds.map((id) => apiClient.put(`/appointments/${id}`, { status })));
    await reload();
  }, [reload]);

  /** Removes an appointment session, which her screen offers from the session
   *  kebab. ⚠ ARCHIVE, not delete — CLAUDE.md's never-hard-delete rule holds,
   *  and a session is SEVERAL appointment rows, so every one is archived or the
   *  session returns half-present on the next read. Hers already did it this
   *  way; taken unchanged. */
  const deleteSession = useCallback(async (session: AppointmentSession) => {
    await Promise.all(session.appointmentIds.map((id) => apiClient.patch(`/appointments/${id}/archive`)));
    await reload();
  }, [reload]);

  return { sessions, dentists, loading, error, reload, updateSessionStatus, deleteSession };
}
