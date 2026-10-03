import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link, useSearchParams } from 'react-router';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Check, Clock, Users, FileText, Mars, Venus, MoreVertical, Trash2, ClipboardList, StickyNote } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { getSchoolShortName } from '../utils/schoolColors';
import { useAppointments, type AppointmentSession } from '../hooks/useAppointments';
import { useDentistRotations } from '../hooks/useDentistRotations';
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
  const navigate = useNavigate();
  const toast = useToast();

  // Tabs
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed' | 'missed' | 'all' | 'calendar'>('today');
  // Filters
  const [gradeFilter, setGradeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals — ?new=1 (e.g. the dashboard's New Appointment CTA) opens the create
  // form directly; the param is stripped below so refresh/back doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('new') === '1');
  const [showRotationModal, setShowRotationModal] = useState(false);
  useEffect(() => {
    if (searchParams.has('new')) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [currentDate, setCurrentDate] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });

  // Escape closes whichever modal is open (a mis-click otherwise traps the user)
  useEffect(() => {
    if (!showCreateModal && !showRotationModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCreateModal(false);
        setShowRotationModal(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreateModal, showRotationModal]);

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

  // Calendar reminder/note form. Backed by the DentistRotation collection —
  // repurposed rather than adding a new model for this (there is no NOTE/
  // REMINDER model in the ERD, and one dentist covering three schools by
  // week never got real use as a staffing schedule). One record = one day's
  // note: week_start and week_end are both set to that date on save. School
  // and dentist are automatic, same as the create-appointment form.
  const [rotDentistId, setRotDentistId] = useState('');
  const [noteDate, setNoteDate] = useState('');
  const [rotNotes, setRotNotes] = useState('');
  const [editingRotationId, setEditingRotationId] = useState<string | null>(null);
  const [rotError, setRotError] = useState<string | null>(null);
  const [rotSaving, setRotSaving] = useState(false);

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
  const { rotations, loading: rotationsLoading, reload: reloadRotations } = useDentistRotations();
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  // Roster to search when creating an appointment — scoped to the school the
  // switcher already has selected, same as every other screen.
  const { students: allStudentsForSearch } = useStudents();

  useEffect(() => {
    apiClient.get<ApiSchool[]>('/schools').then(setSchools).catch(() => {});
  }, []);

  // Default the dentist pickers to the logged-in dentist, once dentists have loaded
  useEffect(() => {
    if (!user || dentists.length === 0) return;
    const own = dentists.find(d => d.user_id === user.id);
    const defaultId = own?._id ?? dentists[0]._id;
    setAppointmentDentistId(prev => prev || defaultId);
    setRotDentistId(prev => prev || defaultId);
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

  const resetRotationForm = () => {
    setNoteDate('');
    setRotNotes('');
    setEditingRotationId(null);
    setRotError(null);
  };

  /** Opens the note modal for one calendar day, pre-filled if this school
   *  already has a note there. */
  const openNoteModal = (dateStr: string) => {
    const existing = rotations.find(r => r.school === selectedSchool && r.weekStart === dateStr && r.weekEnd === dateStr);
    setNoteDate(dateStr);
    setRotNotes(existing?.notes ?? '');
    setEditingRotationId(existing?.id ?? null);
    setRotError(null);
    setShowRotationModal(true);
  };

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
      setCreateError(`${names.join(', ')} already ${duplicates.length === 1 ? 'has' : 'have'} an unresolved appointment — mark it Completed or Missed first.`);
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

  const handleSaveRotation = async () => {
    setRotError(null);
    if (!selectedSchool) {
      setRotError('Pick a specific school first.');
      return;
    }
    if (!noteDate || !rotNotes.trim()) {
      setRotError('Date and note text are required.');
      return;
    }
    if (!rotDentistId) {
      setRotError('No dentist is set up for this clinic yet.');
      return;
    }
    setRotSaving(true);
    try {
      const school = schools.find(s => s.school_name === selectedSchool);
      if (!school) throw new Error('Selected school not found');
      const body = {
        school_id: school._id,
        dentist_id: rotDentistId,
        week_start: noteDate,
        week_end: noteDate,
        notes: rotNotes.trim(),
      };
      if (editingRotationId) {
        await apiClient.put(`/dentist-rotations/${editingRotationId}`, body);
      } else {
        await apiClient.post('/dentist-rotations', body);
      }
      await reloadRotations();
      toast.success('Note saved.');
      resetRotationForm();
      setShowRotationModal(false);
    } catch (err) {
      setRotError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setRotSaving(false);
    }
  };

  const handleDeleteRotation = async () => {
    if (!editingRotationId) return;
    setRotSaving(true);
    try {
      await apiClient.patch(`/dentist-rotations/${editingRotationId}/archive`);
      await reloadRotations();
      toast.success('Note deleted.');
      resetRotationForm();
      setShowRotationModal(false);
    } catch (err) {
      setRotError(err instanceof Error ? err.message : 'Failed to delete note');
    } finally {
      setRotSaving(false);
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
    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <TabActionsMenu tabKey={tabKey} />
    </div>
  );

  const filteredAppointments = appointments.filter(a => {
    if (gradeFilter !== 'all' && a.grade !== gradeFilter) return false;
    if (statusFilter !== 'all' && getStatus(a) !== statusFilter) return false;
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    if (searchTerm && !a.grade.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !a.section.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

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
  // Notes for one day, scoped to the school in view — the range check covers
  // both the normal single-day note (weekStart === weekEnd) and any older
  // multi-day rotation rows already in the database from before this screen
  // was repurposed.
  const getNotesForDay = (date: Date | null) => {
    if (!date || !selectedSchool) return [];
    const ds = toLocalDateString(date);
    return rotations.filter(r => r.school === selectedSchool && r.weekStart <= ds && r.weekEnd >= ds);
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

  // Every list tab but Calendar gets the same three-dot menu → Delete, which
  // toggles a per-row delete icon rather than deleting on the spot (a stray
  // click can't remove an appointment). One menu-open/delete-mode pair
  // shared across tabs, not one per tab, since only one tab is ever visible
  // at a time — kept generic (tabKey-driven) so a second menu item can be
  // added later without a new state variable per tab.
  const [openTabMenu, setOpenTabMenu] = useState<string | null>(null);
  const [deleteModeTab, setDeleteModeTab] = useState<string | null>(null);

  useEffect(() => { setDeleteModeTab(null); setOpenTabMenu(null); }, [activeTab]);

  const TabActionsMenu = ({ tabKey }: { tabKey: string }) => (
    deleteModeTab === tabKey ? (
      <button onClick={() => setDeleteModeTab(null)}
        className="text-xs font-medium text-foreground border border-border rounded-md px-2 py-1 hover:bg-gray-50">
        Done
      </button>
    ) : (
      <div className="relative">
        <button onClick={() => setOpenTabMenu(v => v === tabKey ? null : tabKey)}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-gray-100 hover:text-foreground" title="More options">
          <MoreVertical className="w-4 h-4" />
        </button>
        {openTabMenu === tabKey && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenTabMenu(null)} />
            <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-md py-1 w-40">
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

  const AppointmentCard = ({ a, showActions = false, deleteMode = false }: { a: AppointmentSession; showActions?: boolean; deleteMode?: boolean }) => {
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
    // Meta info as a row of small tags instead of "Label: value" text — same
    // information, read at a glance instead of parsed word by word.
    const chip = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-100 text-xs font-medium text-foreground';
    return (
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div style={{ backgroundColor: iconBg, color: iconColor }} className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
            {genderIcon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">
              {soleStudent ? soleStudent.name : `${a.section} — ${a.grade}`}
            </div>
            {/* One row of tags, using the row's width instead of stacking
                three mostly-empty lines or spelling out "Label: value". */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {soleStudent && (
                <span className={chip} style={{ backgroundColor: gc.light, color: gc.solid }}>
                  {a.grade} <span className="opacity-70 font-normal">· {a.section}</span>
                </span>
              )}
              <span className={chip}>
                <CalendarIcon className="w-3 h-3 text-muted-foreground" /> {shortDate}
              </span>
              <span className={chip}>
                <Clock className="w-3 h-3 text-muted-foreground" /> {a.time}
              </span>
              <span className={chip}>
                <ClipboardList className="w-3 h-3 text-muted-foreground" /> {a.type}
              </span>
              {!soleStudent && (
                <span className={chip}>
                  <Users className="w-3 h-3 text-muted-foreground" /> {a.studentCount} students
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {a.pending && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Pending sync</span>
          )}
          <Link
            to={soleStudent ? `/dental-chart/${soleStudent.id}` : '/dental-charts'}
            className="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-colors"
            title={soleStudent ? `Open ${soleStudent.name}'s Dental Chart` : 'Open Dental Charts'}
          >
            <FileText className="w-3.5 h-3.5" />
          </Link>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(status)}`}>{status}</span>
          {/* Delete mode replaces the status actions with one clear choice,
              so a stray click can't both change status and delete. */}
          {deleteMode && !a.pending ? (
            <button onClick={() => removeAppointment(a)}
              className="w-7 h-7 rounded-full bg-red-100 hover:bg-red-200 text-red-700 flex items-center justify-center transition-colors" title="Delete this appointment">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              {showActions && !a.pending && status === 'Scheduled' && (
                <>
                  <button onClick={() => setConfirmStatusAction({ session: a, status: 'Completed' })}
                    className="w-7 h-7 rounded-full bg-green-100 hover:bg-green-200 text-green-700 flex items-center justify-center transition-colors" title="Mark Attended">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setConfirmStatusAction({ session: a, status: 'Missed' })}
                    className="w-7 h-7 rounded-full bg-red-100 hover:bg-red-200 text-red-700 flex items-center justify-center transition-colors" title="Mark Missed">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {showActions && !a.pending && status === 'In Progress' && (
                <button onClick={() => setConfirmStatusAction({ session: a, status: 'Completed' })}
                  className="w-7 h-7 rounded-full bg-green-100 hover:bg-green-200 text-green-700 flex items-center justify-center transition-colors" title="Mark Completed">
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  if (appointmentsLoading || rotationsLoading) {
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
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''} total</p>
        </div>
        <div className="flex items-center gap-2">
          {/* No export by design (2026-09-02) — see PatientList for the
              reasoning. The DOH report on Reports is the official output. */}
          <button onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover text-sm font-medium">
            <Plus className="w-4 h-4" /> New Appointment
          </button>
        </div>
      </div>

      {/* ── TABS: Today / Upcoming / Completed / Missed ── */}
      {/* max-w-full + scroll: five tabs do not fit a phone, so "Rotation" was
          cut off past the right edge with no way to reach it. */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {[
          { key: 'today',     label: `Today (${todayAppts.length})`            },
          { key: 'upcoming',  label: `Upcoming (${upcomingAppts.length})`      },
          { key: 'completed', label: `Completed (${completedAppts.length})`    },
          { key: 'missed',    label: `Missed (${missedAppts.length})`          },
          { key: 'all',       label: `All (${appointments.length})`            },
          { key: 'calendar',  label: 'Calendar'                                },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className={`flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">

      {/* TODAY */}
      {activeTab === 'today' && (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-bold text-foreground flex-1">Today, {formatDateWithWeekday(TODAY)}</span>
            <TabActionsMenu tabKey="today" />
          </div>
          {todayAppts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No appointments scheduled for today</p>
            </div>
          ) : (
            todayAppts.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === 'today'} />)
          )}
        </>
      )}

      {/* UPCOMING */}
      {activeTab === 'upcoming' && (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Upcoming Appointments</span>
            <TabActionsMenu tabKey="upcoming" />
          </div>
          {upcomingAppts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No upcoming appointments</p>
            </div>
          ) : (
            upcomingAppts.map(a => (
              <div key={a.id} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <div className="text-center min-w-[48px]">
                  <div className="text-lg font-bold text-primary">{a.date.split('-')[2]}</div>
                  <div className="text-xs text-muted-foreground">{new Date(a.date + 'T00:00:00').toLocaleString('default', { month: 'short' })}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <AppointmentCard a={a} showActions deleteMode={deleteModeTab === 'upcoming'} />
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* COMPLETED */}
      {activeTab === 'completed' && (
        <>
          {historyScopeBar('Completed Appointments', 'completed')}
          {completedAppts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No completed appointments</p>
            </div>
          ) : (
            completedAppts.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === 'completed'} />)
          )}
        </>
      )}

      {/* MISSED */}
      {activeTab === 'missed' && (
        <>
          {historyScopeBar('Missed Appointments', 'missed')}
          {missedAppts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No missed appointments</p>
            </div>
          ) : (
            missedAppts.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === 'missed'} />)
          )}
        </>
      )}

      {/* ALL */}
      {activeTab === 'all' && (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">All Appointments</span>
            <TabActionsMenu tabKey="all" />
          </div>
          {allAppts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CalendarIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No appointments loaded for this window</p>
            </div>
          ) : (
            allAppts.map(a => <AppointmentCard key={a.id} a={a} showActions deleteMode={deleteModeTab === 'all'} />)
          )}
        </>
      )}

      {/* CALENDAR — the old "Dentist Rotation Schedule" widget, now doubling
          as a reminders calendar (see the note above the rotation form
          state). Rotation-by-school scheduling is gone: with one dentist
          covering three schools, a per-day note here is more useful than a
          week-range picker nobody was filling in. */}
      {activeTab === 'calendar' && (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Calendar Reminders</span>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-4 h-4 text-muted-foreground"/></button>
              <span className="text-sm font-semibold text-foreground min-w-[110px] text-center">{monthName}</span>
              <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-4 h-4 text-muted-foreground"/></button>
            </div>
          </div>
          {!selectedSchool && (
            <div className="px-4 py-2">
              <Notice variant="warning">Pick a specific school from the school switcher to add reminders — appointments and notes are both kept one school at a time.</Notice>
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
              const dayNotes = getNotesForDay(day);
              const isToday = day && toLocalDateString(day) === TODAY;
              const clickable = day && selectedSchool;
              return (
                <div
                  key={idx}
                  onClick={() => clickable && openNoteModal(toLocalDateString(day!))}
                  title={clickable ? 'Click to add or edit a reminder for this date' : undefined}
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
                          key={n.id}
                          onClick={e => { e.stopPropagation(); openNoteModal(toLocalDateString(day)); }}
                          title={n.notes}
                          className="w-full flex items-start gap-1 text-left text-xs font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                        >
                          <StickyNote className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="leading-snug line-clamp-2 break-words">{n.notes}</span>
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

      {/* ── CREATE APPOINTMENT MODAL ── */}
      {showCreateModal && (
        <Modal onClose={() => { resetCreateAppointmentForm(); setShowCreateModal(false); }} maxWidth="max-w-lg" closeDisabled={creating}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-foreground">New Appointment</h2>
              <button onClick={() => { resetCreateAppointmentForm(); setShowCreateModal(false); }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-4">
              {!selectedSchool ? (
                <Notice variant="warning">Pick a specific school from the school switcher first — appointments are booked one school at a time.</Notice>
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
                              <span className="text-xs text-muted-foreground ml-auto">{s.grade} · {s.section || '—'}</span>
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

      {/* ── ADD/EDIT CALENDAR NOTE MODAL ── */}
      {showRotationModal && (
        <Modal onClose={() => { resetRotationForm(); setShowRotationModal(false); }} closeDisabled={rotSaving}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-foreground">{editingRotationId ? 'Edit Reminder' : 'Add Reminder'}</h2>
                {/* The date was set by which calendar cell was clicked — no
                    separate date field to change it from here. */}
                {noteDate && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(noteDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
              <button onClick={() => { resetRotationForm(); setShowRotationModal(false); }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Note</label>
                <textarea value={rotNotes} onChange={e => setRotNotes(e.target.value)}
                  placeholder="e.g. Bayanihan Mission at BT Annex A"
                  rows={3}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              {rotError && <p className="text-sm text-destructive">{rotError}</p>}
              <div className="flex gap-3 pt-2">
                {editingRotationId && (
                  <button onClick={handleDeleteRotation} disabled={rotSaving}
                    className="px-4 py-2 border border-destructive text-destructive rounded-lg hover:bg-danger-surface text-sm font-medium disabled:opacity-60">
                    Delete
                  </button>
                )}
                <button onClick={() => { resetRotationForm(); setShowRotationModal(false); }}
                  className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">
                  Cancel
                </button>
                <button onClick={handleSaveRotation} disabled={rotSaving}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">
                  {rotSaving ? 'Saving…' : 'Save Reminder'}
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
    </div>
  );
};
