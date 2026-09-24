import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useSearchParams } from 'react-router';
import { Calendar as CalendarIcon, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Plus, X, Check, FileText, Mars, Venus, MoreVertical, Trash2, StickyNote, Pencil } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { getSchoolShortName } from '../utils/schoolColors';
import { useAppointments, type AppointmentSession } from '../hooks/useAppointments';
import { useDayNotes } from '../hooks/useDayNotes';
import { useStudents } from '../hooks/useStudents';
import { apiClient } from '../api/client';
import { Notice } from './Notice';
import { toLocalDateString, formatDateWithWeekday } from '../utils/localDate';
import { schoolYearStart, schoolYearEnd } from '../utils/schoolYear';
import type { ApiSchool } from '../api/types';
import { SkeletonPageHeader, SkeletonStatGrid, SkeletonTable } from './Skeleton';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { PageHeader } from './PageHeader';

/** Fixed options plus a free-text escape hatch — the clinic's actual visit
 *  types are not a closed set, and forcing everything into these six used to
 *  mean picking the closest lie. */
const APPOINTMENT_TYPES = ['Regular Checkup', 'Screening', 'Bayanihan Mission', 'Fluoride Application', 'Extraction', 'Follow-up'];
const OTHER_TYPE = 'Other';


const TODAY = toLocalDateString(new Date());

/** "2026-09-04" -> "Sep 4". Shared by the card meta chips and the
 *  duplicate-booking warning so both read the same way. */
const shortenDate = (dateStr: string) =>
  new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const Appointments = () => {
  const { user, selectedSchool } = useAuth();
  const toast = useToast();

  // Tabs
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed' | 'missed' | 'all' | 'calendar'>('today');
  // Filters
  // ⚠ The grade/status/type/search filters that used to sit here are gone
  // (Sprint 175). Their setters were never called — not on her branch and NOT
  // on ours either, so this is dead code the audit found, not something the
  // redesign lost. `filteredAppointments` read them at their constant defaults
  // and filtered nothing. Leaving them in implied a feature that does not
  // exist; if appointment filtering is wanted, it needs real controls.

  // Modals — ?new=1 (e.g. the dashboard's New Appointment CTA) opens the create
  // form directly; the param is stripped below so refresh/back doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('new') === '1');
  useEffect(() => {
    if (searchParams.has('new')) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [currentDate, setCurrentDate] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });

  // Escape closes the create modal (a mis-click otherwise traps the user)
  useEffect(() => {
    if (!showCreateModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCreateModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreateModal]);

  // Create appointment form. School and dentist are no longer picked here —
  // school follows the sidebar's school switcher (this is a one-school-at-a-
  // time screen everywhere else already) and the clinic has exactly one
  // dentist, defaulted below. Grade/section are dropped as SELECTION filters
  // too: the student search below already scopes to the right school, and a
  // fixed Grade 1-6 picker (the old `grades` list) could not even reach
  // Kinder or Grades 7-10 — real for Bagong Tanyag Integrated, which enrolls
  // K-10, not just the other two schools' K-6.
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  // Sprint 93. Prefilled with today and still fully editable — the user's ask
  // was "automatic dapat yung date na kung ano mang date ngayon pero dapat
  // nacclick pa din para maedit". ⚠ `TODAY` is computed once at module load,
  // which is right for a prefill (a tab open past midnight shows yesterday
  // in a field the user can see and change) and would be wrong for a
  // deadline or a filter default.
  const [appointmentDate, setAppointmentDate] = useState(TODAY);
  const [appointmentTime, setAppointmentTime] = useState('');
  // A visit is often more than one thing at once (a checkup that also gets
  // fluoride, say), and appointment_type is one free-text-ish field on the
  // server — so multiple picks are joined with ", " on submit.
  const [appointmentTypes, setAppointmentTypes] = useState<string[]>([]);
  const [appointmentTypeOther, setAppointmentTypeOther] = useState('');
  const [appointmentDentistId, setAppointmentDentistId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Which appointments are loaded at all (Sprint 56). Today and Upcoming
  // self-limit by date, but Completed and Missed have no such bound and nothing
  // is ever hard deleted, so they used to accumulate every appointment ever
  // created. The window is the current school year, widened to whatever month
  // the calendar is showing so navigating to an older month still finds its
  // appointments.
  const appointmentWindow = useMemo(() => {
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const syStart = schoolYearStart(new Date());
    const syEnd = schoolYearEnd(new Date());
    return {
      from: new Date(Math.min(syStart.getTime(), monthStart.getTime())),
      to: new Date(Math.max(syEnd.getTime(), monthEnd.getTime())),
    };
  }, [currentDate]);

  const { sessions, dentists, loading: appointmentsLoading, error: appointmentsError, updateSessionStatus, deleteSession, reload: reloadAppointments } = useAppointments(appointmentWindow);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  // Roster to search when creating an appointment — scoped to the school the
  // switcher already has selected, same as every other screen.
  const { students: allStudentsForSearch } = useStudents();

  useEffect(() => {
    apiClient.get<ApiSchool[]>('/schools').then(setSchools).catch(() => {});
  }, []);

  // Default the dentist picker to the logged-in dentist, once dentists have loaded
  useEffect(() => {
    if (!user || dentists.length === 0) return;
    const own = dentists.find(d => d.user_id === user.id);
    setAppointmentDentistId(prev => prev || (own?._id ?? dentists[0]._id));
  }, [user, dentists]);

  const resetCreateAppointmentForm = () => {
    setStudentSearch('');
    setSelectedStudents([]);
    // Back to today, NOT blank: clearing it after a save would undo the
    // prefill for the next appointment, which is when it is most wanted.
    setAppointmentDate(TODAY);
    setAppointmentTime('');
    setAppointmentTypes([]);
    setAppointmentTypeOther('');
    setCreateError(null);
  };

  /** Opens the note modal for one calendar day, pre-filled if this school
   *  already has a note there. */
  const handleCreateAppointment = async () => {
    setCreateError(null);
    // Date is the only field the user must fill in by hand — school and
    // dentist are automatic, and time defaults below. A student to book it
    // for and a type to record are still unavoidable: an Appointment row
    // cannot mean anything without either.
    const resolvedType = appointmentTypes
      .map(t => (t === OTHER_TYPE ? appointmentTypeOther.trim() : t))
      .filter(Boolean)
      .join(', ');
    if (!appointmentDate) {
      setCreateError('Date is required.');
      return;
    }
    if (selectedStudents.length === 0) {
      setCreateError('Select at least one student.');
      return;
    }
    // Belt-and-suspenders: the picker already disables a student with an
    // unresolved appointment, but the underlying data can change (e.g. a
    // second tab) between opening this search and clicking Create.
    const duplicates = selectedStudents.filter(id => pendingAppointmentFor(id));
    if (duplicates.length > 0) {
      const names = duplicates.map(id => allStudentsForSearch.find(s => s.id === id)?.name ?? 'A selected student');
      setCreateError(`${names.join(', ')} already ${duplicates.length === 1 ? 'has' : 'have'} an unresolved appointment. Mark it Completed or Missed first.`);
      return;
    }
    if (!resolvedType) {
      setCreateError(
        appointmentTypes.includes(OTHER_TYPE) && !appointmentTypeOther.trim()
          ? 'Type the "Other" appointment type, or pick a listed one.'
          : 'Select at least one appointment type.',
      );
      return;
    }
    if (!appointmentDentistId) {
      setCreateError('No dentist is set up for this clinic yet.');
      return;
    }
    setCreating(true);
    try {
      // Left blank, time defaults to the clinic's usual opening rather than
      // blocking the save on a field the user asked not to require.
      const appointment_datetime = new Date(`${appointmentDate}T${appointmentTime || '08:00'}`).toISOString();
      await Promise.all(
        selectedStudents.map(student_id =>
          apiClient.post('/appointments', {
            student_id,
            dentist_id: appointmentDentistId,
            appointment_datetime,
            status: 'Scheduled',
            appointment_type: resolvedType,
          }),
        ),
      );
      await reloadAppointments();
      toast.success(`Appointment scheduled for ${selectedStudents.length} student${selectedStudents.length !== 1 ? 's' : ''}.`);
      resetCreateAppointmentForm();
      setShowCreateModal(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create appointment');
    } finally {
      setCreating(false);
    }
  };


  // Search results for the create-appointment picker: this school's active,
  // synced roster, name-matched. Kinder and Grades 7-10 are reachable here —
  // the old grade dropdown was hardcoded to Grade 1-6 and could not book an
  // appointment for either, which was simply wrong for Bagong Tanyag
  // Integrated (K-10, not K-6 like the other two schools).
  const studentSearchResults = useMemo(() => {
    if (!selectedSchool || !studentSearch.trim()) return [];
    const q = studentSearch.trim().toLowerCase();
    return allStudentsForSearch
      .filter(s => !s.pending && s.school === selectedSchool && s.name.toLowerCase().includes(q))
      .slice(0, 25);
  }, [allStudentsForSearch, selectedSchool, studentSearch]);

  const appointments: AppointmentSession[] = selectedSchool
    ? sessions.filter(a => a.school === selectedSchool)
    : sessions;

  // A student with an unresolved appointment (Scheduled or In Progress —
  // anything but Completed or Missed) can't be booked again on ANY date
  // until that one is resolved. Not a same-day check: the point is one
  // open booking per student at a time, not one per day.
  const pendingSessionByStudent = useMemo(() => {
    const map = new Map<string, AppointmentSession>();
    for (const s of appointments) {
      if (s.status === 'Completed' || s.status === 'Missed') continue;
      for (const st of s.students) map.set(st.id, s);
    }
    return map;
  }, [appointments]);
  const pendingAppointmentFor = (studentId: string) => pendingSessionByStudent.get(studentId);

  const getStatus = (a: AppointmentSession) => a.status;

  // Tab filters
  // Resolved (Completed/Missed) appointments move to their own tabs even
  // when the date is today — Today is "what's still open today", not
  // "everything dated today".
  const todayAppts = appointments.filter(a => a.date === TODAY && getStatus(a) !== 'Completed' && getStatus(a) !== 'Missed');
  const upcomingAppts = appointments.filter(a => a.date > TODAY && getStatus(a) === 'Scheduled');
  const completedAppts = appointments.filter(a => getStatus(a) === 'Completed');
  // Past-dated sessions never marked Completed/Missed would otherwise appear in no tab at all
  const missedAppts = appointments.filter(a => getStatus(a) === 'Missed' || (a.date < TODAY && getStatus(a) === 'Scheduled'));
  // ALL — every appointment loaded for this school, regardless of status,
  // chronological so it reads like a full schedule rather than a log.
  const allAppts = [...appointments].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const historyScopeBar = (label: string, tabKey: string) => (
    <div className="sticky top-1 z-10 bg-card px-4 py-3 border-b border-border flex items-center justify-between">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <TabActionsMenu tabKey={tabKey} />
    </div>
  );

  // Empty state, matching the reference: a light icon chip, a bold title,
  // a muted one-line explanation. Replaces the old bare icon + <p>.
  const EmptyState = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className="py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <CalendarIcon className="w-6 h-6 text-muted-foreground/60" />
      </div>
      <p className="text-base font-bold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );

  const filteredAppointments = appointments.filter(a => {
    return true;
  });

  // Sprint 108 — notes written against a DATE (holiday, no-clinic day,
  // equipment down), distinct from a per-patient remark. Bounded to the month
  // on screen; see useDayNotes.
  const { notesFor, reload: reloadDayNotes } = useDayNotes(currentDate);
  const [noteDay, setNoteDay] = useState<Date | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const canWriteNotes = !!user && ['system_admin', 'dentist', 'dental_aide'].includes(user.role);

  const openDay = (day: Date | null) => {
    if (!day) return;
    setNoteDay(day);
    setNoteDraft('');
  };

  const saveDayNote = async () => {
    if (!noteDay || !noteDraft.trim()) return;
    setNoteSaving(true);
    try {
      await apiClient.post('/day-notes', {
        // Midnight local, so one calendar square is one date.
        date: toLocalDateString(noteDay),
        // ⚠ null means EVERY school — that is the barangay-wide holiday case,
        // and it is what "All Schools" in the switcher should produce. When a
        // specific school is selected the note is scoped to it. `selectedSchool`
        // is a NAME, so it has to be mapped back to an id here.
        school_id: schools.find((sc) => sc.school_name === selectedSchool)?._id ?? null,
        note: noteDraft.trim(),
      });
      setNoteDraft('');
      await reloadDayNotes();
      toast.success('Note added.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the note');
    } finally {
      setNoteSaving(false);
    }
  };

  // Sprint 109 — a remark on ONE pupil's slot, distinct from the day note.
  const [apptNoteId, setApptNoteId] = useState<string | null>(null);
  const [apptNoteDraft, setApptNoteDraft] = useState('');
  const [apptNoteSaving, setApptNoteSaving] = useState(false);

  const saveApptNote = async (appointmentId: string) => {
    setApptNoteSaving(true);
    try {
      await apiClient.put(`/appointments/${appointmentId}`, { notes: apptNoteDraft.trim() });
      setApptNoteId(null);
      setApptNoteDraft('');
      await reloadAppointments();
      toast.success('Note saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the note');
    } finally {
      setApptNoteSaving(false);
    }
  };

  // Sprint 131 — editing an existing day note. `PUT /day-notes/:id` has
  // accepted CLINICAL_WRITE_ROLES since Sprint 108; nothing in the UI ever
  // called it, so correcting a typo meant archiving the note and retyping it —
  // which left the wrong note in the archive permanently.
  const [dayNoteEditId, setDayNoteEditId] = useState<string | null>(null);
  const [dayNoteEditDraft, setDayNoteEditDraft] = useState('');
  const [dayNoteEditSaving, setDayNoteEditSaving] = useState(false);

  const saveDayNoteEdit = async (id: string) => {
    if (!dayNoteEditDraft.trim()) return;
    setDayNoteEditSaving(true);
    try {
      await apiClient.put(`/day-notes/${id}`, { note: dayNoteEditDraft.trim() });
      setDayNoteEditId(null);
      setDayNoteEditDraft('');
      await reloadDayNotes();
      toast.success('Note updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the note');
    } finally {
      setDayNoteEditSaving(false);
    }
  };

  const archiveDayNote = async (id: string) => {
    try {
      await apiClient.patch(`/day-notes/${id}/archive`);
      await reloadDayNotes();
      toast.success('Note removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the note');
    }
  };

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: (Date | null)[] = [];
    for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };
  const getAppointmentsForDay = (date: Date | null) => {
    if (!date) return [];
    const ds = toLocalDateString(date);
    return filteredAppointments.filter(a => a.date === ds);
  };
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1));
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth(currentDate);

  const markStatus = async (session: AppointmentSession, status: string) => {
    // previously fire-and-forget — a failed status update was silent
    try {
      await updateSessionStatus(session, status);
      toast.success(`Appointment marked ${status.toLowerCase()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update appointment status');
    }
  };

  // Mark Attended / Mark Missed / Mark Completed all go through this
  // confirmation instead of firing on the first click — a wrong tap here
  // used to silently flip a student's attendance record.
  const [confirmStatusAction, setConfirmStatusAction] = useState<{ session: AppointmentSession; status: string } | null>(null);
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const confirmStatusChange = async () => {
    if (!confirmStatusAction) return;
    setConfirmingStatus(true);
    await markStatus(confirmStatusAction.session, confirmStatusAction.status);
    setConfirmingStatus(false);
    setConfirmStatusAction(null);
  };

  const removeAppointment = async (session: AppointmentSession) => {
    try {
      await deleteSession(session);
      toast.success('Appointment deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete appointment');
    }
  };

  // Reschedule — a missed/overdue appointment's real fix isn't always
  // "attended" or "missed"; it's often "give this a new slot". Moves the
  // underlying appointment_datetime (same PUT the create form uses) and
  // resets status to Scheduled, since a rescheduled visit is not the old
  // missed one anymore.
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentSession | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const openReschedule = (session: AppointmentSession) => {
    setRescheduleTarget(session);
    setRescheduleDate(session.date);
    setRescheduleTime(session.time);
    setRescheduleError(null);
  };

  const closeReschedule = () => {
    if (rescheduling) return;
    setRescheduleTarget(null);
  };

  const submitReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate) {
      setRescheduleError('Pick a date to reschedule to.');
      return;
    }
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const appointment_datetime = new Date(`${rescheduleDate}T${rescheduleTime || '08:00'}`).toISOString();
      await Promise.all(
        rescheduleTarget.appointmentIds.map(id =>
          apiClient.put(`/appointments/${id}`, { appointment_datetime, status: 'Scheduled' }),
        ),
      );
      await reloadAppointments();
      toast.success('Appointment rescheduled.');
      setRescheduleTarget(null);
    } catch (err) {
      setRescheduleError(err instanceof Error ? err.message : 'Failed to reschedule appointment');
    } finally {
      setRescheduling(false);
    }
  };

  // Every list tab but Calendar gets the same three-dot menu → Delete, which
  // toggles a per-row delete icon rather than deleting on the spot (a stray
  // click can't remove an appointment). One menu-open/delete-mode pair
  // shared across tabs, not one per tab, since only one tab is ever visible
  // at a time — kept generic (tabKey-driven) so a second menu item can be
  // added later without a new state variable per tab.
  const [openTabMenu, setOpenTabMenu] = useState<string | null>(null);
  const [tabMenuAt, setTabMenuAt] = useState<{ top: number; right: number } | null>(null);
  const [deleteModeTab, setDeleteModeTab] = useState<string | null>(null);
  // Same reasoning, one level down: which CARD's "Actions" menu (missed/
  // overdue cards) is open, keyed by appointment id. AppointmentCard is
  // itself declared inside this component and re-created on every render,
  // so state local to it would reset (closing the menu) on any unrelated
  // re-render of this page -- keeping it here, in the stable parent, avoids
  // that.
  const [openCardMenu, setOpenCardMenu] = useState<string | null>(null);
  const [cardMenuAt, setCardMenuAt] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => { setDeleteModeTab(null); setOpenTabMenu(null); setOpenCardMenu(null); }, [activeTab]);

  const TabActionsMenu = ({ tabKey }: { tabKey: string }) => (
    deleteModeTab === tabKey ? (
      <button onClick={() => setDeleteModeTab(null)}
        className="text-xs font-medium text-foreground border border-border rounded-md px-2 py-1 hover:bg-gray-50">
        Done
      </button>
    ) : (
      <div className="relative">
        <button onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setTabMenuAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
            setOpenTabMenu(v => v === tabKey ? null : tabKey);
          }}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-gray-100 hover:text-foreground" title="More options">
          <MoreVertical className="w-4 h-4" />
        </button>
        {openTabMenu === tabKey && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenTabMenu(null)} />
            {/* ⚠ FIXED, not absolute. This card is `overflow-hidden`,
                and a clipping ancestor cuts an absolutely positioned
                menu off at its edge — the school-year menu looked like
                a dead button for exactly that reason. Positioned from
                the trigger's own rect so no ancestor can clip it. */}
            <div
              style={tabMenuAt ? { top: tabMenuAt.top, right: tabMenuAt.right } : undefined}
              className="fixed z-50 bg-card border border-border rounded-lg shadow-md py-1 w-40"
            >
              <button
                onClick={() => { setDeleteModeTab(tabKey); setOpenTabMenu(null); }}
                className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-danger-surface flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete…
              </button>
            </div>
          </>
        )}
      </div>
    )
  );

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      'Scheduled': 'bg-blue-100 text-blue-700',
      'In Progress': 'bg-yellow-100 text-yellow-700',
      'Completed': 'bg-green-100 text-green-700',
      'Missed': 'bg-red-100 text-red-700',
      'Cancelled': 'bg-gray-100 text-muted-foreground',
    };
    return map[status] || 'bg-gray-100 text-muted-foreground';
  };

  // Solid fill for the card's time block + the border tint around the whole
  // card -- same hue family as statusBadge above (blue/yellow/green/red/gray),
  // just a bold block instead of a soft chip, so a card reads its status at
  // a glance without needing to read the text badge too.
  // 'Today' is a display-only pseudo-status (not a real value of
  // AppointmentSession.status) so a Scheduled card happening today reads
  // differently from one that's still days out -- otherwise every Scheduled
  // card was the same blue whether it needed attention right now or not.
  const statusBlock = (status: string | 'Today'): string => {
    const map: Record<string, string> = {
      'Today': '#C026D3',
      'Scheduled': '#2563EB',
      'In Progress': '#CA8A04',
      'Completed': '#16A34A',
      'Missed': '#DC2626',
      'Cancelled': '#6B7280',
    };
    return map[status] || '#6B7280';
  };

  // "HH:MM" (24h, as stored) -> the 12h clock + AM/PM shown in the card's
  // time block.
  const formatTimeBlock = (time: string) => {
    const [hStr, mStr] = time.split(':');
    let h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return { clock: `${String(h).padStart(2, '0')}:${mStr}`, ampm };
  };

  // Groups a session list into consecutive same-date runs, sorted first --
  // Missed/Completed/All aren't guaranteed sorted like `allAppts` already is
  // -- so a "THURSDAY, SEPTEMBER 4" caption can sit above each date's cards,
  // matching the agreed agenda-timeline layout.
  const groupByDate = (list: AppointmentSession[]) => {
    const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const groups: { date: string; items: AppointmentSession[] }[] = [];
    for (const a of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.date === a.date) last.items.push(a);
      else groups.push({ date: a.date, items: [a] });
    }
    return groups;
  };

  const DateGroupedCards = ({ list, tabKey }: { list: AppointmentSession[]; tabKey: string }) => (
    <div className="p-3">
      {groupByDate(list).map((group, gi) => (
        <div key={group.date} className={gi > 0 ? 'mt-4' : ''}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1 mb-2">
            {formatDateWithWeekday(group.date)}
          </div>
          {group.items.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === tabKey} />)}
        </div>
      ))}
    </div>
  );

  // ⚠ `compact` exists because this card is ALSO rendered inside the day
  // dialog's left half — roughly 340px, against the ~1300px list it was drawn
  // for. At that width the chips wrap one per line, the section name truncates
  // to "Del Pi…", and a tidy row becomes four ragged ones. Compact drops the
  // date (the dialog's title IS the date) and the pupil count (the pupils are
  // listed directly underneath), which are the two chips that say nothing new
  // in that context.
  const AppointmentCard = ({ a, showActions = false, deleteMode = false, compact = false }: { a: AppointmentSession; showActions?: boolean; deleteMode?: boolean; compact?: boolean }) => {
    const gc = getGradeColor(a.grade);
    const status = getStatus(a);
    // The common case now that appointments are booked by searching a
    // student rather than a whole section: one student per booking. That
    // student's own name and chart replace the section-level summary; a
    // multi-student booking (still possible — the picker allows selecting
    // more than one) falls back to the old grouped view, since there is no
    // single chart to link to.
    const soleStudent = a.studentCount === 1 ? a.students[0] : null;
    const shortDate = shortenDate(a.date);
    // School and dentist dropped from the card: the page is already scoped
    // to one school at a time via the switcher, and the clinic has exactly
    // one dentist, so both were repeating information on every row. The
    // grade square is a gender icon when there's exactly one student on the
    // booking — a mixed-gender group keeps the grade initial, since no
    // single icon would be honest there.
    // Pink for girls, blue for boys — a fixed pair regardless of grade, so
    // the icon reads as sex at a glance rather than blending into whatever
    // color that grade happens to be. Grade color is still what identifies
    // the grade, just not on this badge anymore. A mixed-gender group (no
    // single student) keeps the grade-colored initial, since no one icon
    // would be honest there.
    const isFemale = soleStudent?.gender === 'Female';
    const isMale = soleStudent?.gender === 'Male';
    const iconBg = isFemale ? '#FCE7F3' : isMale ? '#DBEAFE' : gc.light;
    const iconColor = isFemale ? '#DB2777' : isMale ? '#1E40AF' : gc.solid;
    const genderIcon = isMale
      ? <Mars className="w-5 h-5" />
      : isFemale
        ? <Venus className="w-5 h-5" />
        : a.grade.replace('Grade ', 'G');
    // The time block's color is the SAME "effectively missed" rule the
    // Missed tab itself filters by (past-dated and never explicitly marked)
    // -- so a card sitting in that tab visually reads as missed even before
    // anyone clicks the X to record it as such in the database. The text
    // badge stays on the real stored status ("Scheduled"): that is still
    // true until someone confirms otherwise, only the color is a preview.
    const isOverdueUnmarked = a.date < TODAY && status === 'Scheduled';
    const isScheduledToday = a.date === TODAY && status === 'Scheduled';
    const blockFill = statusBlock(isOverdueUnmarked ? 'Missed' : isScheduledToday ? 'Today' : status);
    const { clock, ampm } = formatTimeBlock(a.time);
    const actionsOpen = openCardMenu === a.id;
    return (
      <div className="flex overflow-hidden rounded-2xl border border-border shadow-sm mb-2.5 last:mb-0">
        {/* Time block — solid fill by status, same hue family as the text
            badge below, so the card's status reads before you even get to
            the badge. */}
        <div className="w-[72px] sm:w-[84px] flex-shrink-0 flex flex-col items-center justify-center px-2 py-3" style={{ backgroundColor: blockFill }}>
          <div className="text-[15px] sm:text-base font-extrabold text-white tabular-nums">{clock}</div>
          <div className="text-[9.5px] font-semibold text-white/75 mt-0.5">{ampm}</div>
        </div>

        <div className="flex-1 min-w-0 bg-card flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <div style={{ backgroundColor: iconBg, color: iconColor }} className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">
              {genderIcon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-foreground truncate">
                  {soleStudent ? soleStudent.name : `${a.section} · ${a.grade}`}
                </span>
                <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${statusBadge(status)}`}>{status}</span>
                {a.pending && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Pending sync</span>
                )}
              </div>
              {/* Plain meta line (grade/section · date · treatment), matching
                  the chosen agenda-card layout — the chip row this replaced
                  is a later refinement, not part of this pass. */}
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {soleStudent ? <>{a.grade} · {a.section}</> : <>{a.studentCount} students</>}
                {!compact && <> · {shortDate}</>}
                {' · '}{a.type}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Delete mode replaces the status actions with one clear choice,
                so a stray click can't both change status and delete. */}
            {deleteMode && !a.pending ? (
              <button onClick={() => removeAppointment(a)}
                className="w-7 h-7 rounded-full bg-red-100 hover:bg-red-200 text-red-700 flex items-center justify-center transition-colors" title="Delete this appointment">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                {/* In Progress is the one status still worth a single plain
                    button (Mark Completed) -- Reschedule/No-Show make no
                    sense mid-visit, so a 3-item menu would be two dead
                    options. Every Scheduled card (today's or not) gets the
                    full Actions menu below instead: a same-day appointment
                    can still turn into a no-show before the day is over, so
                    "not yet overdue" was never a reason to hide that option. */}
                {showActions && !a.pending && status === 'In Progress' && (
                  <button onClick={() => setConfirmStatusAction({ session: a, status: 'Completed' })}
                    className="w-7 h-7 rounded-full bg-green-100 hover:bg-green-200 text-green-700 flex items-center justify-center transition-colors" title="Mark Completed">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* Scheduled or Missed: one menu instead of a row of icons --
                    attended, reschedule, or confirm no-show, each going
                    through its own confirmation (the status changes reuse
                    the existing dialog; reschedule opens its own form). */}
                {showActions && !a.pending && (status === 'Scheduled' || status === 'Missed') && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        // Flip upward when there isn't room below -- a
                        // 3-item menu is roughly 140px tall (2 items, no
                        // No-Show option, a bit less); estimating high
                        // avoids a downward menu clipping at the viewport
                        // edge, which is the bug this fixes.
                        const estMenuHeight = 150;
                        const right = Math.max(8, window.innerWidth - r.right);
                        setCardMenuAt(
                          window.innerHeight - r.bottom < estMenuHeight
                            ? { bottom: window.innerHeight - r.top + 4, right }
                            : { top: r.bottom + 4, right },
                        );
                        setOpenCardMenu(v => v === a.id ? null : a.id);
                      }}
                      className="flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full bg-gray-100 hover:bg-gray-200 text-foreground text-xs font-semibold transition-colors"
                      title="Resolve this appointment"
                    >
                      Actions <ChevronDown className={`w-3 h-3 transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {actionsOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenCardMenu(null)} />
                        <div
                          style={cardMenuAt ?? undefined}
                          className="fixed z-50 bg-card border border-border rounded-lg shadow-md py-1 w-52"
                        >
                          <button
                            onClick={() => { setOpenCardMenu(null); setConfirmStatusAction({ session: a, status: 'Completed' }); }}
                            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Check className="w-3.5 h-3.5 text-green-600" /> Mark Attended
                          </button>
                          <button
                            onClick={() => { setOpenCardMenu(null); openReschedule(a); }}
                            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-gray-50 flex items-center gap-2"
                          >
                            <CalendarClock className="w-3.5 h-3.5 text-primary" /> Reschedule
                          </button>
                          {/* A future date can't be a no-show yet -- only
                              today's or an already-past appointment can. */}
                          {a.date <= TODAY && (
                            <button
                              onClick={() => { setOpenCardMenu(null); setConfirmStatusAction({ session: a, status: 'Missed' }); }}
                              className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-danger-surface flex items-center gap-2"
                            >
                              <X className="w-3.5 h-3.5" /> Confirm No-Show
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {/* Dental chart is always the rightmost icon -- it's the one
                constant across every status, so it anchors the same spot
                whether it's sitting next to a Delete button, an Actions
                menu, a single check, or nothing at all. */}
            <Link
              to={soleStudent ? `/dental-chart/${soleStudent.id}` : '/dental-charts'}
              className="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"
              title={soleStudent ? `Open ${soleStudent.name}'s Dental Chart` : 'Open Dental Charts'}
            >
              <FileText className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  };

  if (appointmentsLoading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonStatGrid count={4} />
        <SkeletonTable rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {appointmentsError && <Notice variant="error">{appointmentsError}</Notice>}
      {/* Header
          ⚠ A SESSION IS NOT AN APPOINTMENT. `appointments` here is the
          session list — one scheduled slot holding several pupils, which is
          what each card below shows — so this line read "10 appointments
          total" for a school with 14 appointment rows. The tab counts are
          session counts and are right, because the cards are sessions; only
          this total claimed to be something it was not. Both units now,
          named. */}
      <PageHeader
        icon={CalendarIcon}
        eyebrow="Scheduling"
        title="Appointments"
        description={`${appointments.length} session${appointments.length !== 1 ? 's' : ''} covering ${appointments.reduce((n, a) => n + a.appointmentIds.length, 0)} appointment${appointments.reduce((n, a) => n + a.appointmentIds.length, 0) !== 1 ? 's' : ''}.`}
        action={
          // No export by design (2026-09-02) — see PatientList for the
          // reasoning. The DOH report on Reports is the official output.
          <button onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover text-sm font-medium">
            <Plus className="w-4 h-4" /> New Appointment
          </button>
        }
      />

      {/* ── LEFT RAIL: Today / Upcoming / Completed / Missed / All / Calendar ──
          Vertical view switcher next to the agenda, replacing the old
          horizontal pill strip -- the six tabs never fit a 390px phone as a
          row, and the rail scrolls its own short list instead of fighting
          the page for width. Below md it stacks above the content like the
          old strip did. */}
      <div className="flex flex-col md:flex-row gap-5 md:min-h-[calc(100vh-260px)]">
        <nav className="flex md:flex-col gap-1 md:w-[200px] flex-shrink-0 overflow-x-auto md:overflow-visible">
          {[
            // Fixed brand navy for every tab's active fill -- status color
            // (red Missed, green Completed) lives on the cards themselves
            // (time block, badge), not on the rail's own selection state.
            { key: 'today',     label: 'Today',     count: todayAppts.length,     fill: '#273A78' },
            { key: 'upcoming',  label: 'Upcoming',  count: upcomingAppts.length,  fill: '#273A78' },
            { key: 'completed', label: 'Completed', count: completedAppts.length, fill: '#273A78' },
            { key: 'missed',    label: 'Missed',    count: missedAppts.length,    fill: '#273A78' },
            { key: 'all',       label: 'All',       count: appointments.length,   fill: '#273A78' },
            { key: 'calendar',  label: 'Calendar',  count: null,                  fill: '#273A78' },
          ].map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
                style={isActive ? { backgroundColor: tab.fill } : undefined}
                className={`flex-shrink-0 flex items-center justify-between gap-3 whitespace-nowrap px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-gray-100'
                }`}>
                <span>{tab.label}</span>
                {tab.count !== null && <span className={isActive ? 'text-white/80' : 'opacity-55'}>{tab.count}</span>}
              </button>
            );
          })}
        </nav>

        {/* ── TAB CONTENT ── */}
        {/* This box, not the page, is what scrolls: capped to the viewport
            (minus the topbar + page header above it) so a long appointment
            list scrolls inside its own container instead of the header,
            rail and everything else scrolling away with it. Each tab's own
            header bar (Today's date strip, historyScopeBar, etc.) is
            `sticky top-0` inside it so it stays pinned while the list
            beneath scrolls. `no-scrollbar` keeps it scrollable (wheel/touch/
            keyboard) without drawing the OS scrollbar track. */}
        <div className="no-scrollbar flex-1 min-w-0 bg-card rounded-xl border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)] overflow-y-auto max-h-[calc(100vh-260px)]">
          {/* Top accent stripe, matching the reference card -- sticky and
              above every other sticky header in this box (z-20 vs their
              z-10) so it stays visible as the sole rounded band at the very
              top while everything beneath scrolls under it. */}
          <div className="sticky top-0 z-20 h-1 bg-primary rounded-t-xl" />

      {/* TODAY */}
      {activeTab === 'today' && (
        <>
          <div className="sticky top-1 z-10 bg-card px-4 py-3 border-b border-border flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-bold text-foreground flex-1">Today, {formatDateWithWeekday(TODAY)}</span>
            <TabActionsMenu tabKey="today" />
          </div>
          {todayAppts.length === 0 ? (
            <EmptyState title="No appointments found" subtitle="There are no appointments scheduled for today." />
          ) : (
            <div className="p-3">
              {todayAppts.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === 'today'} />)}
            </div>
          )}
        </>
      )}

      {/* UPCOMING */}
      {activeTab === 'upcoming' && (
        <>
          <div className="sticky top-1 z-10 bg-card px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Upcoming Appointments</span>
            <TabActionsMenu tabKey="upcoming" />
          </div>
          {upcomingAppts.length === 0 ? (
            <EmptyState title="No appointments found" subtitle="There are no upcoming appointments scheduled." />
          ) : (
            <DateGroupedCards list={upcomingAppts} tabKey="upcoming" />
          )}
        </>
      )}

      {/* COMPLETED */}
      {activeTab === 'completed' && (
        <>
          {historyScopeBar('Completed Appointments', 'completed')}
          {completedAppts.length === 0 ? (
            <EmptyState title="No appointments found" subtitle="There are currently no completed appointments." />
          ) : (
            <DateGroupedCards list={completedAppts} tabKey="completed" />
          )}
        </>
      )}

      {/* MISSED */}
      {activeTab === 'missed' && (
        <>
          {historyScopeBar('Missed Appointments', 'missed')}
          {missedAppts.length === 0 ? (
            <EmptyState title="No appointments found" subtitle="There are currently no missed appointments." />
          ) : (
            <DateGroupedCards list={missedAppts} tabKey="missed" />
          )}
        </>
      )}

      {/* ALL */}
      {activeTab === 'all' && (
        <>
          <div className="sticky top-1 z-10 bg-card px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">All Appointments</span>
            <TabActionsMenu tabKey="all" />
          </div>
          {allAppts.length === 0 ? (
            <EmptyState title="No appointments found" subtitle="No appointments are loaded for this window." />
          ) : (
            <DateGroupedCards list={allAppts} tabKey="all" />
          )}
        </>
      )}

      {/* CALENDAR — a per-day reminders calendar, backed by DAY_NOTE.
          Rotation-by-school scheduling is gone for good (the tab was removed
          2026-09-07): with one dentist covering three schools, a per-day note
          here is more useful than a week-range picker nobody was filling in,
          and no objective or ERD entity asked for the schedule. If it is ever
          wanted back, the answer is a cross-school week view, not this. */}
      {activeTab === 'calendar' && (
        <>
          <div className="sticky top-1 z-10 bg-card px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Calendar Reminders</span>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-4 h-4 text-muted-foreground"/></button>
              <span className="text-sm font-semibold text-foreground min-w-[110px] text-center">{monthName}</span>
              <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-4 h-4 text-muted-foreground"/></button>
            </div>
          </div>
          {!selectedSchool && (
            <div className="px-4 py-2">
              <Notice variant="warning">Pick a specific school from the school switcher to add reminders. Appointments and notes are both kept one school at a time.</Notice>
            </div>
          )}
          <div className="grid grid-cols-7 border-b border-border">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2 bg-gray-50">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, idx) => {
              const dayAppts = getAppointmentsForDay(day);
              // ⚠ OUR day notes (DAY_NOTE), not rotation rows. Her branch
              // repurposed DENTIST_ROTATION as the notes table; ours has a
              // model for this, and the badge must show the same notes the
              // day dialog edits or the two disagree on one screen.
              const dayNotes = day ? notesFor(day) : [];
              const isToday = day && toLocalDateString(day) === TODAY;
              const clickable = day && selectedSchool;
              return (
                <div
                  key={idx}
                  onClick={() => clickable && openDay(day)}
                  title={clickable ? 'Open this day: schedule and notes' : undefined}
                  className={`min-h-[82px] p-1.5 border-r border-b border-gray-100 last:border-b-0 space-y-1 ${!day ? 'bg-gray-50/60' : ''} ${isToday ? 'bg-teal-50' : ''} ${clickable ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                >
                  {day && (
                    <>
                      <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-teal-600 text-white' : 'text-foreground'}`}>
                        {day.getDate()}
                      </div>
                      {dayAppts.map(a => {
                        const gc = getGradeColor(a.grade);
                        return (
                          <div key={a.id} style={{ backgroundColor: gc.light, color: gc.solid }}
                            className="text-xs font-medium px-1.5 py-0.5 rounded-md leading-snug line-clamp-2 break-words">
                            {a.time} {a.section}
                          </div>
                        );
                      })}
                      {dayNotes.map(n => (
                        <button
                          key={n._id}
                          onClick={e => { e.stopPropagation(); openDay(day); }}
                          title={n.note}
                          className="w-full flex items-start gap-1 text-left text-xs font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                        >
                          <StickyNote className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="leading-snug line-clamp-2 break-words">{n.note}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

        </div>{/* end tab content box */}
      </div>{/* end rail + content row */}

      {/* ── CREATE APPOINTMENT MODAL ── */}
      {noteDay && (
        <Modal onClose={() => setNoteDay(null)} maxWidth="max-w-4xl" closeDisabled={noteSaving}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-foreground">{formatDateWithWeekday(toLocalDateString(noteDay))}</h2>
            <button onClick={() => setNoteDay(null)} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Close"><X className="w-4 h-4"/></button>
          </div>
          {/* ⚠ NOT an even split. The left half carries session cards, pupil
              rows and their notes; the right is one textarea and a button. An
              even split starved the side with all the content — the section
              name truncated and every chip wrapped. */}
          <div className="p-5 grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-5">

            {/* ── READ HALF ─────────────────────────────────────────────── */}
            <div className="space-y-4 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Appointments</p>
                {getAppointmentsForDay(noteDay).length === 0 ? (
                  <p className="text-sm text-muted-foreground">None scheduled.</p>
                ) : (
                  <ul className="space-y-2">
                    {getAppointmentsForDay(noteDay).map((a) => (
                      <li key={a.id}>
                        {/* The SAME card the Today / Upcoming / Completed /
                            Missed tabs use, with its real actions - mark
                            completed, mark missed, re-open. It was already in
                            scope here; this dialog just never used it and
                            offered a note editor and nothing else. */}
                        <AppointmentCard a={a} showActions compact />
                        {/* Student rows stay NESTED under the card. The card is
                            per SESSION (time + grade + section) while these are
                            the individual pupils in it, so replacing them with
                            the card alone would have lost the per-pupil note
                            and the link to that pupil's chart. */}
                        <ul className="mt-1 space-y-1 pl-3 border-l-2 border-gray-100">
                          {a.students.map((st) => (
                            <li key={st.appointmentId} className="text-xs">
                              <div className="flex items-start justify-between gap-2">
                                {/* Straight to THIS pupil's record. The card's
                                    own link goes to the chart LIST, which is
                                    the right target for a session and the
                                    wrong one for a named pupil. */}
                                <Link to={`/dental-chart/${st.id}`} className="text-foreground hover:text-primary hover:underline">
                                  {st.name}
                                </Link>
                                {canWriteNotes && apptNoteId !== st.appointmentId && (
                                  <button
                                    onClick={() => { setApptNoteId(st.appointmentId); setApptNoteDraft(st.notes); }}
                                    className="text-primary hover:underline shrink-0"
                                  >
                                    {st.notes ? 'Edit note' : 'Add note'}
                                  </button>
                                )}
                              </div>
                              {apptNoteId === st.appointmentId ? (
                                <div className="mt-1 space-y-1">
                                  <input
                                    value={apptNoteDraft}
                                    onChange={(e) => setApptNoteDraft(e.target.value)}
                                    maxLength={500}
                                    placeholder="e.g. bring guardian"
                                    aria-label={`Note for ${st.name}`}
                                    className="w-full px-2 py-1 text-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                                  />
                                  <div className="flex gap-1.5">
                                    <button onClick={() => saveApptNote(st.appointmentId)} disabled={apptNoteSaving}
                                      className="px-2 py-0.5 text-xs bg-primary text-white rounded disabled:opacity-50">
                                      {apptNoteSaving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button onClick={() => { setApptNoteId(null); setApptNoteDraft(''); }} disabled={apptNoteSaving}
                                      className="px-2 py-0.5 text-xs border border-border rounded">Cancel</button>
                                  </div>
                                </div>
                              ) : st.notes ? (
                                <p className="text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 mt-0.5">{st.notes}</p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Notes on this date</p>
                {notesFor(noteDay).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes on this date.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {notesFor(noteDay).map((n) => (
                      <li key={n._id} className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        {dayNoteEditId === n._id ? (
                          <div className="space-y-1.5">
                            <textarea
                              value={dayNoteEditDraft}
                              onChange={(e) => setDayNoteEditDraft(e.target.value)}
                              maxLength={500}
                              rows={2}
                              aria-label="Edit note"
                              className="w-full px-2 py-1 text-sm border border-amber-300 rounded bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <div className="flex gap-1.5">
                              <button onClick={() => saveDayNoteEdit(n._id)} disabled={dayNoteEditSaving || !dayNoteEditDraft.trim()}
                                className="px-2 py-0.5 text-xs bg-primary text-white rounded disabled:opacity-50">
                                {dayNoteEditSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={() => { setDayNoteEditId(null); setDayNoteEditDraft(''); }} disabled={dayNoteEditSaving}
                                className="px-2 py-0.5 text-xs border border-border rounded bg-card">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-amber-900">
                              {n.note}
                              {/* A note with no school applies everywhere — say so,
                                  rather than leaving the reader to infer it. */}
                              <span className="block text-[11px] text-amber-700/80">
                                {n.school_id ? (schools.find((sc) => sc._id === n.school_id)?.school_name ?? 'One school') : 'All schools'}
                              </span>
                            </span>
                            {canWriteNotes && (
                              <span className="flex items-center gap-1.5 shrink-0">
                                {/* Edit, new in Sprint 131. Until now the only
                                    way to correct a typo was to remove the note
                                    and retype it, which left the wrong wording
                                    in the archive for good. */}
                                <button onClick={() => { setDayNoteEditId(n._id); setDayNoteEditDraft(n.note); }}
                                  className="text-amber-700 hover:text-primary" aria-label="Edit note">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {/* "Remove" on screen, ARCHIVE underneath — the
                                    record is never hard deleted and a System
                                    Admin can restore it from /archive. */}
                                <button onClick={() => archiveDayNote(n._id)} className="text-amber-700 hover:text-destructive" aria-label="Remove note">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ── WRITE HALF ────────────────────────────────────────────── */}
            <div className="md:border-l md:border-gray-100 md:pl-5">
              {canWriteNotes ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add a note</p>
                  {/* Grows with what is typed instead of holding two lines and
                      scrolling a long note out of sight (user, 2026-09-05),
                      capped so it can never push the Add button off a phone. */}
                  <textarea
                    value={noteDraft}
                    onChange={(e) => {
                      setNoteDraft(e.target.value);
                      // ⚠ `scrollHeight` excludes the border, and the box is
                      // border-box — without the +2 the element ends up two
                      // pixels short of its own content and shows a scrollbar
                      // for text that is already fully visible.
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      const grown = Math.min(el.scrollHeight + 2, 220);
                      el.style.height = `${grown}px`;
                      el.style.overflowY = el.scrollHeight + 2 > 220 ? 'auto' : 'hidden';
                    }}
                    maxLength={500}
                    rows={3}
                    placeholder="e.g. No clinic, holiday"
                    aria-label="New note for this date"
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg resize-y overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{noteDraft.length}/500</span>
                    <span className="text-[11px] text-muted-foreground">
                      {selectedSchool ? 'This school only' : 'All schools'}
                    </span>
                  </div>
                  <button
                    onClick={saveDayNote}
                    disabled={noteSaving || !noteDraft.trim()}
                    className="w-full px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {noteSaving ? 'Saving…' : 'Add note'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Your role can read day notes but not write them.</p>
              )}
            </div>
          </div>
        </Modal>
      )}


      {showCreateModal && (
        <Modal onClose={() => { resetCreateAppointmentForm(); setShowCreateModal(false); }} maxWidth="max-w-lg" closeDisabled={creating}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-foreground">New Appointment</h2>
              <button onClick={() => { resetCreateAppointmentForm(); setShowCreateModal(false); }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-4">
              {!selectedSchool ? (
                <Notice variant="warning">Pick a specific school from the school switcher first. Appointments are booked one school at a time.</Notice>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Search Students at {getSchoolShortName(selectedSchool)}
                    </label>
                    <input
                      type="text"
                      value={studentSearch}
                      onChange={e => setStudentSearch(e.target.value)}
                      placeholder="Type a student's name…"
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  {studentSearch.trim() && (
                    <div className="border border-border rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100">
                      {studentSearchResults.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-3">No students match "{studentSearch}".</p>
                      ) : studentSearchResults.map(s => {
                        const isSelected = selectedStudents.includes(s.id);
                        // Blocked while they have an unresolved appointment,
                        // on any date — not just this one — rather than
                        // leaving it for the submit error.
                        const pending = !isSelected ? pendingAppointmentFor(s.id) : undefined;
                        return (
                          <label key={s.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-gray-50 ${pending ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                            <input type="checkbox" checked={isSelected} disabled={!!pending}
                              onChange={() => setSelectedStudents(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                              className="w-4 h-4 rounded accent-primary" />
                            <span className="text-sm text-foreground">{s.name}</span>
                            {pending ? (
                              <span className="text-xs text-destructive ml-auto">{pending.status} for {shortenDate(pending.date)}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground ml-auto">{s.grade} · {s.section || 'N/A'}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {selectedStudents.length > 0 && (
                    <p className="text-xs text-muted-foreground">{selectedStudents.length} student{selectedStudents.length === 1 ? '' : 's'} selected.</p>
                  )}
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Date *</label>
                  <input type="date" value={appointmentDate} onChange={e => setAppointmentDate(e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Time</label>
                  <input type="time" value={appointmentTime} onChange={e => setAppointmentTime(e.target.value)}
                    placeholder="Defaults to 8:00 AM"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" />
                  <p className="text-[11px] text-muted-foreground mt-1">Defaults to 8:00 AM if left blank.</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-2">
                    Appointment Type <span className="font-normal">(pick any that apply)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[...APPOINTMENT_TYPES, OTHER_TYPE].map(t => {
                      const selected = appointmentTypes.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setAppointmentTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            selected
                              ? 'bg-primary text-white border-primary'
                              : 'bg-card text-foreground border-border hover:bg-gray-50'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3" />}
                          {t === OTHER_TYPE ? 'Other' : t}
                        </button>
                      );
                    })}
                  </div>
                  {appointmentTypes.includes(OTHER_TYPE) && (
                    <input
                      type="text"
                      value={appointmentTypeOther}
                      onChange={e => setAppointmentTypeOther(e.target.value)}
                      placeholder="Type the appointment type"
                      className="w-full mt-2 text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                </div>
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { resetCreateAppointmentForm(); setShowCreateModal(false); }}
                  className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">
                  Cancel
                </button>
                <button onClick={handleCreateAppointment} disabled={creating}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">
                  {creating ? 'Creating…' : 'Create Appointment'}
                </button>
              </div>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmStatusAction}
        title={confirmStatusAction?.status === 'Missed' ? 'Mark as missed?' : 'Mark as attended?'}
        message={
          confirmStatusAction
            ? `This marks ${confirmStatusAction.session.studentCount === 1 ? confirmStatusAction.session.students[0]?.name ?? 'this student' : `${confirmStatusAction.session.studentCount} students`} as ${confirmStatusAction.status.toLowerCase()} for this appointment.`
            : ''
        }
        confirmLabel={confirmStatusAction?.status === 'Missed' ? 'Mark Missed' : 'Mark Attended'}
        tone={confirmStatusAction?.status === 'Missed' ? 'danger' : 'default'}
        busy={confirmingStatus}
        onConfirm={confirmStatusChange}
        onCancel={() => setConfirmStatusAction(null)}
      />

      {/* ── RESCHEDULE MODAL ── */}
      {rescheduleTarget && (
        <Modal onClose={closeReschedule} maxWidth="max-w-sm" closeDisabled={rescheduling}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-foreground">Reschedule Appointment</h2>
            <button onClick={closeReschedule} disabled={rescheduling} className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              {rescheduleTarget.studentCount === 1
                ? rescheduleTarget.students[0]?.name ?? 'This student'
                : `${rescheduleTarget.studentCount} students`}
              {': pick a new date and time. This also clears the missed status.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">New Date *</label>
                <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">New Time</label>
                <input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            {rescheduleError && <Notice variant="error">{rescheduleError}</Notice>}
          </div>
          <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
            <button onClick={closeReschedule} disabled={rescheduling}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
              Cancel
            </button>
            <button onClick={submitReschedule} disabled={rescheduling}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">
              {rescheduling ? 'Rescheduling…' : 'Reschedule'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
