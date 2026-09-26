import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Eye, Users, Calendar, Clipboard, Shield, Stethoscope, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, X, ChevronDown } from 'lucide-react';
import { GradePill } from './GradePill';
import { getSchoolColor } from '../utils/schoolColors';
import { getGradeColor } from '../utils/gradeColors';
import { ListSearchInput } from './ListSearchInput';
import { getQueuedStudentIds, setQueuedStudentIds as persistQueuedStudentIds } from '../utils/queueStorage';
import { useStudents } from '../hooks/useStudents';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import type { ApiAppointment, ApiStudentIptr, ApiTreatment } from '../api/types';
import { toLocalDateString } from '../utils/localDate';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';

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
  // Reactive, not a one-time useMemo (user, 2026-09-26): clicking a stat
  // card can now auto-queue students, which has to show up immediately in
  // both this list and the Queue #/Students Queue count, not just after a
  // fresh page load.
  const [queuedStudentIds, setQueuedStudentIds] = useState<string[]>(() => getQueuedStudentIds());
  // Which stat card (if any) is narrowing the queue beyond viewMode alone --
  // Appointments Today / RPC filter to a specific set of students; Students
  // Queue and the "Clear filter" chip reset it (user, 2026-09-26).
  const [extraFilter, setExtraFilter] = useState<'none' | 'appointments-today' | 'rpc-outstanding'>('none');
  // Up Next can be hidden to give the queue table more width (user,
  // 2026-09-26).
  const [showUpNext, setShowUpNext] = useState(true);
  // The single "Filter" button's dropdown (replaces the old Queued/Full
  // List segmented toggle, user, 2026-09-26). State lives here, not inside
  // a nested component defined in the render body -- that component gets a
  // NEW function identity every render, so React remounts it (and drops
  // `open` back to false, mid-click) any time this component re-renders for
  // an unrelated reason. Confirmed via Playwright: the button detached from
  // the DOM and reattached on every render while a click was in flight.
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (!filterMenuRef.current?.contains(e.target as Node)) setFilterMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterMenuOpen]);
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
  // appointment on today's LOCAL calendar date. Kept as the actual student
  // ID set, not just a count (user, 2026-09-26) -- clicking the card queues
  // and filters to exactly these students.
  const [appointmentsTodayIds, setAppointmentsTodayIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const appts = await apiClient.get<ApiAppointment[]>('/appointments');
      const today = toLocalDateString(new Date());
      const schoolIds = new Set(allPatients.map((p) => p.id));
      const ids = new Set(
        appts
          .filter((a) => !a.isArchived && schoolIds.has(a.student_id) && toLocalDateString(new Date(a.appointment_datetime)) === today)
          .map((a) => a.student_id),
      );
      if (!cancelled) setAppointmentsTodayIds(ids);
    })();
    return () => { cancelled = true; };
  }, [allPatients]);
  const appointmentsToday = appointmentsTodayIds.size;

  // RPC: outstanding (pending or overdue Visit 2) rows at this school --
  // same 'outstanding' meaning RPC Monitoring's own default view uses.
  // limit: 1 -- only `.total` is read, not the rows themselves.
  // limit: 1000, not 1 (user, 2026-09-26) -- clicking the card now filters
  // the queue to these exact students, which needs their ids, not just the
  // count. A single school's outstanding-RPC population is nowhere near
  // this cap.
  const { total: rpcOutstandingCount, records: rpcOutstandingRecords } = useRPCTracking({ school: selectedSchool ?? undefined, status: 'outstanding', limit: 1000 });
  const rpcOutstandingIds = useMemo(() => new Set(rpcOutstandingRecords.map((r) => r.id)), [rpcOutstandingRecords]);

  // No grade/section/gender/age filters (user, 2026-09-25 — removed in
  // favor of a single, fixed sort). Search only; order is always by queue
  // position, with un-queued students (Full List only) pushed after the
  // queued ones and broken by name.
  const filtered = useMemo(() => {
    const rows = sourcePatients.filter((p) => {
      // Stat-card filter (user, 2026-09-26): narrows to exactly the
      // students that card represents, on top of whatever viewMode/search
      // already apply.
      if (extraFilter === 'appointments-today' && !appointmentsTodayIds.has(p.id)) return false;
      if (extraFilter === 'rpc-outstanding' && !rpcOutstandingIds.has(p.id)) return false;
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
  }, [sourcePatients, searchTerm, queuedStudentIds, extraFilter, appointmentsTodayIds, rpcOutstandingIds]);

  // No pagination (user, 2026-09-26 — removed): the queue card scrolls its
  // own rows internally (see regionRef/rowsBoxRef below) instead of paging,
  // so every filtered row renders and scrolling the box reaches the rest.

  // Adaptive, PINNED queue card (user, 2026-09-26 — fixed AGAIN: sticking the
  // card to the document at `top: TOPBAR_H` worked for where it landed, but
  // any page that can scroll at all gets the BROWSER's own scrollbar, which
  // is chrome outside our DOM and always spans the full window from y:0 --
  // it visually ran straight through the fixed top bar. The actual fix is to
  // never let the page/document scroll in the first place: this whole
  // section becomes its OWN bounded, internally-scrolling region (height =
  // remaining viewport, `overflow-y-auto`), so any scrollbar it shows is
  // confined to its own box, below the top bar, not the window's. The queue
  // card then sticks at `top-0` of THAT region instead of the document, and
  // fills the same remaining height once stuck -- the rows box inside it
  // keeps its own separate internal scroll for the list itself, unchanged.
  const regionRef = useRef<HTMLDivElement | null>(null);
  const rowsBoxRef = useRef<HTMLDivElement | null>(null);
  const [regionHeight, setRegionHeight] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      if (!regionRef.current) return;
      const top = regionRef.current.getBoundingClientRect().top;
      setRegionHeight(Math.max(window.innerHeight - top, 200));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [studentsLoading]);

  // Trims any stray page scroll the estimate above leaves behind -- mainly
  // <main>'s own bottom padding (p-4/md:p-8 around every routed page, see
  // Root.tsx), which the negative margin below cancels but isn't the only
  // possible source. Same correction pass RPC Monitoring and Student
  // Records use.
  useLayoutEffect(() => {
    if (regionHeight == null) return;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow > 0) {
      setRegionHeight((h) => (h == null ? h : Math.max(h - overflow, 200)));
    }
  }, [regionHeight]);

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

  // Each card is clickable (user, 2026-09-26):
  // - Students Queue: back to the plain queued view, clearing any filter.
  // - Appointments Today: queues everyone with an appointment today (adding
  //   them to the persisted queue, not just filtering) AND filters the list
  //   down to exactly them -- the user's own distinction: this one "should
  //   be automatically queued", the others below only filter.
  // - For Treatment: leaves this page entirely, for the Treatment submodule.
  // - RPC: filters (Full List, since these students aren't necessarily
  //   queued) down to students with an outstanding RPC visit.
  const handleStudentsQueueClick = () => {
    setViewMode('queued');
    setExtraFilter('none');
  };
  const handleAppointmentsTodayClick = () => {
    const merged = Array.from(new Set([...queuedStudentIds, ...appointmentsTodayIds]));
    persistQueuedStudentIds(merged);
    setQueuedStudentIds(merged);
    setViewMode('queued');
    setExtraFilter('appointments-today');
  };
  const handleForTreatmentClick = () => navigate('/treatment-records');
  const handleRpcClick = () => {
    setViewMode('full');
    setExtraFilter('rpc-outstanding');
  };

  // Styled after RAMHIS's Doctor Queue stat row (user, 2026-09-25), each tied
  // to a real, already-computed count above -- nothing here is a placeholder
  // number.
  const statCards = [
    { label: 'Students Queue', value: allPatients.filter((p) => queuedStudentIds.includes(p.id)).length, icon: Users, bg: '#E8ECF6', fg: '#273A78', onClick: handleStudentsQueueClick },
    { label: 'Appointments Today', value: appointmentsToday, icon: Calendar, bg: '#FFFBEB', fg: '#B45309', onClick: handleAppointmentsTodayClick },
    { label: 'For Treatment', value: forTreatmentCount, icon: Clipboard, bg: '#EFF6FF', fg: '#1D4ED8', onClick: handleForTreatmentClick },
    { label: 'RPC', value: rpcOutstandingCount, icon: Shield, bg: '#FDF2F8', fg: '#BE185D', onClick: handleRpcClick },
  ];

  const queueCount = filtered.length;

  // Replaces the old Queued/Full List segmented toggle with a single button
  // (user, 2026-09-26) -- same effect (picking viewMode, clearing any stat
  // filter), just as a dropdown off one dark, filled button instead of two
  // side-by-side ones. Rendered inline below, not as a nested component --
  // see the filterMenuOpen state above for why.
  const viewModeOpts: { v: 'queued' | 'full'; l: string }[] = [
    { v: 'queued', l: 'Queued' },
    { v: 'full', l: 'Full List' },
  ];

  return (
    <div ref={regionRef} className="space-y-4 overflow-y-auto no-scrollbar -mb-4 md:-mb-8" style={{ height: regionHeight ?? undefined }}>
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
        {statCards.map(({ label, value, icon: Icon, bg, fg, onClick }) => (
          <div
            key={label}
            {...activatable(onClick)}
            // Same hover spec as Dashboard's own SummaryCell (user,
            // 2026-09-26): -translate-y + primary-tinted border + the exact
            // shadow, not a generic hover:shadow-md.
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)] cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
          >
            <span style={{ backgroundColor: bg, color: fg }} className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-muted-foreground truncate">{label}</div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Up Next can be collapsed to a slim strip so the queue table gets
          its width back (user, 2026-09-26) -- the freed ~236px goes
          straight to the queue card via the grid template itself, not just
          visually. */}
      <div className={`grid gap-4 items-start ${showUpNext ? 'lg:grid-cols-[280px_1fr]' : 'lg:grid-cols-[44px_1fr]'}`}>
        {showUpNext ? (
        /* "Up Next": shorter than the queue table beside it (user,
            2026-09-25 -- option B of the design review), not stretched to
            match its full height. Mirrors RAMHIS's own empty state when
            nothing is queued. */
        <div className="relative overflow-hidden bg-card rounded-2xl border border-border shadow-sm p-5 flex flex-col items-center justify-center text-center gap-2 min-h-[200px]">
          {/* Blue top accent bar (user, 2026-09-25). */}
          <div style={{ backgroundColor: '#273A78' }} className="absolute top-0 left-0 right-0 h-1.5" />
          <button
            onClick={() => setShowUpNext(false)}
            aria-label="Hide Up Next panel"
            title="Hide Up Next"
            className="absolute top-3 right-3 z-10 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
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
        ) : (
          // Compact, not stretched to match the queue card's height -- a
          // small icon control, as asked, not another tall panel.
          <button
            onClick={() => setShowUpNext(true)}
            aria-label="Show Up Next panel"
            title="Show Up Next"
            className="flex items-center justify-center h-11 lg:w-11 rounded-2xl border border-border bg-card shadow-sm text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

      {/* The card is sticky at `top-0` of the bounded region above (user,
          2026-09-26), not the document -- pinning it to the document at
          TOPBAR_H worked for position, but any page-level scroll at all
          brings the browser's own scrollbar, full window height, straight
          through the fixed top bar. Since the region itself is now the only
          thing that scrolls, the card sticks within IT instead. Same
          height math as the region: once stuck, it sits exactly where the
          region starts and fills to the region's own bottom. */}
      {/* Square bottom corners, not rounded (user, 2026-09-26): this card's
          height is always exactly `regionHeight`, so its bottom edge is
          always flush against the bottom of the screen once pinned -- unlike
          RPC Monitoring/Student Records' "Hide" toggle, there's no shorter
          state here where a rounded bottom corner would ever be correct. */}
      <div className="sticky top-0 z-30 flex flex-col bg-card rounded-t-2xl border border-border shadow-sm overflow-clip" style={{ height: regionHeight ?? undefined }}>
        {/* Queue card's own header, restyled after the RAMHIS "Patient
            Queue" reference exactly -- icon badge, gray eyebrow, title with
            a count pill, one-line description, search + view toggle at the
            top right (user, 2026-09-25). No grade/section/gender/age
            filters any more -- order is fixed to queue position (see
            `filtered` above), so those controls had nothing left to do. */}
        <div className="p-5 sm:p-6 border-b border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-gray-100 grid place-items-center flex-shrink-0">
                <SlidersHorizontal className="w-4.5 h-4.5 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Queue</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <h2 className="text-lg font-bold text-foreground">Charting Queue</h2>
                  <span style={{ backgroundColor: kickerColor.light, color: kickerColor.solid }} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    {queueCount} {queueCount === 1 ? 'STUDENT' : 'STUDENTS'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    {extraFilter === 'appointments-today'
                      ? 'Showing students with an appointment today.'
                      : extraFilter === 'rpc-outstanding'
                      ? 'Showing students with an outstanding RPC visit.'
                      : 'Students in queue order, ready for dental charting.'}
                  </span>
                  {extraFilter !== 'none' && (
                    <button
                      onClick={() => setExtraFilter('none')}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="w-3 h-3" /> Clear filter
                    </button>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <ListSearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search student, grade, or section" />
              <div ref={filterMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  role="combobox"
                  aria-haspopup="listbox"
                  aria-expanded={filterMenuOpen}
                  onClick={() => setFilterMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-2 bg-primary text-white hover:bg-primary-hover"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Filter <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {filterMenuOpen && (
                  <div className="absolute right-0 z-20 mt-1 min-w-[160px] rounded-lg border border-border bg-card shadow-md py-1">
                    {viewModeOpts.map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => { setViewMode(o.v); setExtraFilter('none'); setFilterMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-canvas ${viewMode === o.v ? 'text-primary font-semibold' : 'text-foreground'}`}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* The rows box, not the card, is what actually scrolls (user,
            2026-09-26) -- column headings stick to the TOP OF THIS BOX via
            `sticky` on each `<th>`, not the `<tr>` (a sticky `<tr>` renders
            as a duplicate mid-table in some browsers, see PatientList). */}
        <div ref={rowsBoxRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky top-0 z-10 text-left px-4 py-3 sm:pl-6 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Student</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grade</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Section</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gender</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Age</th>
                {/* Position in the actual queue (queueStorage's stored order,
                    user 2026-09-25) — NOT the row index in `#`, which follows
                    this list's own alphabetical sort and can disagree with
                    who was queued first. Blank for a student never queued. */}
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Queue #</th>
                <th className="sticky top-0 z-10 text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:pr-6">Actions</th>
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
              ) : filtered.map((p, i) => {
                const queuePosition = queuedStudentIds.indexOf(p.id);
                const age = calculateAge(p.birthdate);
                const gc = getGradeColor(p.grade);
                const open = () => navigate(`/dental-chart/${p.id}?tab=history&context=dental-queue`);
                return (
                  <tr key={p.id} {...activatable(open)} className="hover:bg-canvas cursor-pointer">
                    <td className="px-4 py-2.5 sm:pl-6 text-muted-foreground">{i + 1}</td>
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
      </div>
      </div>
    </div>
  );
};
