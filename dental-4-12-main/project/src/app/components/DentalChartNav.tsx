import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Eye, Users, Calendar, Clipboard, Shield, Stethoscope, SlidersHorizontal } from 'lucide-react';
import { GradePill } from './GradePill';
import { getSchoolColor } from '../utils/schoolColors';
import { getGradeColor } from '../utils/gradeColors';
import { ListSearchInput } from './ListSearchInput';
import { getQueuedStudentIds } from '../utils/queueStorage';
import { useStudents } from '../hooks/useStudents';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import type { ApiAppointment, ApiStudentIptr, ApiTreatment } from '../api/types';
import { toLocalDateString } from '../utils/localDate';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { Pagination, usePagination } from './Pagination';

/** Two-letter initials for the row avatar. Same derivation her Student
 *  Records rows use, so a pupil is recognised by the same mark on both
 *  screens rather than two near-misses. */
const initials = (name: string) =>
  name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

const calculateAge = (birthdate: string) => {
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

export const DentalChartNav = () => {
  const navigate = useNavigate();
  // Open on Full List when nothing is queued — an empty default view reads as a dead page
  const [viewMode, setViewMode] = useState<'queued' | 'full'>(() => (getQueuedStudentIds().length ? 'queued' : 'full'));
  const [searchTerm, setSearchTerm] = useState('');
  const queuedStudentIds = useMemo(() => getQueuedStudentIds(), []);
  const { selectedSchool } = useAuth();
  const { students: allStudents, loading: studentsLoading } = useStudents();
  // School-scoped like every other list page
  const allPatients = useMemo(
    () => (selectedSchool ? allStudents.filter((s) => s.school === selectedSchool) : allStudents),
    [allStudents, selectedSchool],
  );

  const sourcePatients = useMemo(
    () => (viewMode === 'queued' ? allPatients.filter((p) => queuedStudentIds.includes(p.id)) : allPatients),
    [viewMode, queuedStudentIds, allPatients],
  );

  // ── Stat row + "Up Next" spotlight (user, 2026-09-25) ───────────────────
  // Whoever is first in the ACTUAL queue order (queueStorage), not the
  // table's own alphabetical sort — same distinction as the Queue # column.
  const upNext = useMemo(
    () => (queuedStudentIds.length ? allPatients.find((p) => p.id === queuedStudentIds[0]) ?? null : null),
    [queuedStudentIds, allPatients],
  );

  // For Treatment: students at this school with at least one TREATMENT
  // record — same query TreatmentRecords.tsx runs for its own "Treatment
  // List" view, so the two counts can't disagree.
  const [treatmentStudentIds, setTreatmentStudentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [iptrs, treatments] = await Promise.all([
        apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
        apiClient.get<ApiTreatment[]>('/treatments'),
      ]);
      const studentIdByIptr = new Map(iptrs.map((i) => [i._id, i.student_id]));
      const ids = new Set(treatments.map((t) => studentIdByIptr.get(t.iptr_id)).filter((id): id is string => !!id));
      if (!cancelled) setTreatmentStudentIds(ids);
    })();
    return () => { cancelled = true; };
  }, []);
  const forTreatmentCount = useMemo(
    () => allPatients.filter((p) => treatmentStudentIds.has(p.id)).length,
    [allPatients, treatmentStudentIds],
  );

  // Appointments Today: this school's pupils with a non-archived
  // appointment on today's LOCAL calendar date.
  const [appointmentsToday, setAppointmentsToday] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const appts = await apiClient.get<ApiAppointment[]>('/appointments');
      const today = toLocalDateString(new Date());
      const schoolIds = new Set(allPatients.map((p) => p.id));
      const count = appts.filter((a) => !a.isArchived && schoolIds.has(a.student_id) && toLocalDateString(new Date(a.appointment_datetime)) === today).length;
      if (!cancelled) setAppointmentsToday(count);
    })();
    return () => { cancelled = true; };
  }, [allPatients]);

  // RPC: outstanding (pending or overdue Visit 2) rows at this school --
  // same 'outstanding' meaning RPC Monitoring's own default view uses.
  // limit: 1 -- only `.total` is read, not the rows themselves.
  const { total: rpcOutstandingCount } = useRPCTracking({ school: selectedSchool ?? undefined, status: 'outstanding', limit: 1 });

  // No grade/section/gender/age filters (user, 2026-09-25 — removed in
  // favor of a single, fixed sort). Search only; order is always by queue
  // position, with un-queued students (Full List only) pushed after the
  // queued ones and broken by name.
  const filtered = useMemo(() => {
    const rows = sourcePatients.filter((p) => {
      if (!searchTerm) return true;
      const query = searchTerm.toLowerCase();
      const formattedName = p.name.toLowerCase();
      return formattedName.includes(query) || p.grade.toLowerCase().includes(query) || p.section.toLowerCase().includes(query);
    });
    return [...rows].sort((a, b) => {
      const qa = queuedStudentIds.indexOf(a.id);
      const qb = queuedStudentIds.indexOf(b.id);
      const posA = qa >= 0 ? qa : Infinity;
      const posB = qb >= 0 ? qb : Infinity;
      return posA !== posB ? posA - posB : a.name.localeCompare(b.name);
    });
  }, [sourcePatients, searchTerm, queuedStudentIds]);

  // Paged (Sprint 58). This is the real Dental Charts list page — it rendered
  // every filtered row, which is thousands at ~8,000 students. Reset keys are
  // the filter inputs, never `filtered` — see Pagination.tsx.
  const pager = usePagination(filtered, [searchTerm, viewMode]);

  if (studentsLoading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  // Her Student Records card, applied here (Sprint 161). ⚠ NOT adopted from
  // her branch — she never restyled this screen either, so there was nothing to
  // copy. It kept the pre-adoption look while everything around it became hers,
  // which is why it read as the odd one out. The patterns are lifted from her
  // PatientList so the two rosters are recognisably the same screen.
  const kickerColor = getSchoolColor(selectedSchool || '');

  // Four cards, styled after RAMHIS's Doctor Queue stat row (user,
  // 2026-09-25), each tied to a real, already-computed count above --
  // nothing here is a placeholder number.
  const statCards = [
    { label: 'Students Queue', value: allPatients.filter((p) => queuedStudentIds.includes(p.id)).length, icon: Users, bg: '#E8ECF6', fg: '#273A78' },
    { label: 'Appointments Today', value: appointmentsToday, icon: Calendar, bg: '#FFFBEB', fg: '#B45309' },
    { label: 'For Treatment', value: forTreatmentCount, icon: Clipboard, bg: '#EFF6FF', fg: '#1D4ED8' },
    { label: 'RPC', value: rpcOutstandingCount, icon: Shield, bg: '#FDF2F8', fg: '#BE185D' },
  ];

  const queueCount = filtered.length;

  return (
    <div className="space-y-4">
      {/* Page-level identity header, above the stat row and the queue itself
          (user, 2026-09-25). No card/border -- sits directly on the page.
          Generic module eyebrow ("Clinical Services") instead of the school
          name, which is already shown in the top bar; description is a
          fixed line about what the module does, not a live count (the
          queue card below already gives the real number). */}
      <div className="flex items-center gap-4">
        <span style={{ backgroundColor: kickerColor.light }} className="w-12 h-12 rounded-2xl grid place-items-center flex-shrink-0">
          <Stethoscope style={{ color: kickerColor.solid }} className="w-6 h-6" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Clinical Services</div>
          <h1 className="text-2xl font-bold text-foreground mt-0.5">Dental Charts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage student dental charts and the charting queue.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, bg, fg }) => (
          <div key={label} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
            <span style={{ backgroundColor: bg, color: fg }} className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground truncate">{label}</div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
        {/* "Up Next": shorter than the queue table beside it (user,
            2026-09-25 -- option B of the design review), not stretched to
            match its full height. Mirrors RAMHIS's own empty state when
            nothing is queued. */}
        <div className="relative overflow-hidden bg-card rounded-2xl border border-border shadow-sm p-5 flex flex-col items-center justify-center text-center gap-2 min-h-[200px]">
          {/* Blue top accent bar (user, 2026-09-25). */}
          <div style={{ backgroundColor: '#273A78' }} className="absolute top-0 left-0 right-0 h-1.5" />
          {upNext ? (
            <>
              <span style={{ backgroundColor: '#E8ECF6', color: '#273A78' }} className="w-12 h-12 rounded-full grid place-items-center text-sm font-bold">
                {initials(upNext.name)}
              </span>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Up Next</div>
              <div className="font-bold text-foreground">{upNext.name}</div>
              <div className="text-xs text-muted-foreground">{upNext.grade} · {upNext.section} · Queue #1</div>
              <button
                onClick={() => navigate(`/dental-chart/${upNext.id}?tab=history&context=dental-queue`)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
              >
                <Eye className="w-3.5 h-3.5" /> Open chart
              </button>
            </>
          ) : (
            <>
              {/* Blue fill, matching the populated avatar above (user,
                  2026-09-25) -- was a plain gray circle. */}
              <span style={{ backgroundColor: '#E8ECF6', color: '#273A78' }} className="w-12 h-12 rounded-full grid place-items-center">
                <Users className="w-5 h-5" />
              </span>
              <div className="font-bold text-foreground">No Students Queued</div>
              <div className="text-xs text-muted-foreground">Use "Queue for Charting" on the Students page.</div>
            </>
          )}
        </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Queue card's own header, restyled after the RAMHIS "Patient
            Queue" reference exactly -- icon badge, gray eyebrow, title with
            a count pill, one-line description, search + view toggle at the
            top right (user, 2026-09-25). No grade/section/gender/age
            filters any more -- order is fixed to queue position (see
            `filtered` above), so those controls had nothing left to do. */}
        <div className="p-5 sm:p-6 border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-gray-100 grid place-items-center flex-shrink-0">
                <SlidersHorizontal className="w-4.5 h-4.5 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Queue</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <h2 className="text-lg font-bold text-foreground">Charting Queue</h2>
                  <span style={{ backgroundColor: kickerColor.light, color: kickerColor.solid }} className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    {queueCount} {queueCount === 1 ? 'STUDENT' : 'STUDENTS'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">Students in queue order, ready for dental charting.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <ListSearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search student, grade, or section" />
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 shrink-0">
                <button
                  onClick={() => setViewMode('queued')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'queued' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Queued
                </button>
                <button
                  onClick={() => setViewMode('full')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'full' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Full List
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 sm:pl-6 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Student</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grade</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Section</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gender</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Age</th>
                {/* Position in the actual queue (queueStorage's stored order,
                    user 2026-09-25) — NOT the row index in `#`, which follows
                    this list's own alphabetical sort and can disagree with
                    who was queued first. Blank for a student never queued. */}
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Queue #</th>
                <th className="text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {viewMode === 'queued' && queuedStudentIds.length === 0
                      ? 'No students queued for charting yet — use "Queue for Charting" on the Students page, or switch to Full List.'
                      : 'No students match your search.'}
                  </td>
                </tr>
              ) : pager.paged.map((p, i) => {
                const queuePosition = queuedStudentIds.indexOf(p.id);
                const age = calculateAge(p.birthdate);
                const gc = getGradeColor(p.grade);
                const open = () => navigate(`/dental-chart/${p.id}?tab=history&context=dental-queue`);
                return (
                  <tr key={p.id} {...activatable(open)} className="hover:bg-canvas cursor-pointer">
                    <td className="px-4 py-2.5 sm:pl-6 text-muted-foreground">{pager.from + i}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      <div className="flex items-center gap-3">
                        <span style={{ backgroundColor: gc.light, color: gc.solid }} className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-xs font-bold">
                          {initials(p.name)}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><GradePill grade={p.grade} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.section}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.gender}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{age}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{queuePosition >= 0 ? queuePosition + 1 : '—'}</td>
                    <td className="px-4 py-2.5 sm:pr-6">
                      {/* The row was already clickable; the button makes that
                          visible rather than folklore, and matches the Actions
                          column her Student Records carries. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); open(); }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                      >
                        <Eye className="w-3.5 h-3.5" /> Open chart
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="border-t border-border bg-card px-5 py-4 sm:px-6">
            <Pagination
              {...pager}
              onPage={pager.setPage}
              onPageSize={pager.changePageSize}
              noun={viewMode === 'queued' ? 'queued students' : 'students'}
              detail={[
                filtered.length !== sourcePatients.length ? `(filtered from ${sourcePatients.length})` : '',
                selectedSchool ? `at ${selectedSchool}` : '',
              ].filter(Boolean).join(' ')}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
};
