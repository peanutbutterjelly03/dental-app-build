import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft, ArrowRight, Bell, BellRing, CalendarDays, ChevronDown, CircleCheck, CircleX, Clock, Eye, EyeOff, GraduationCap,
  Hourglass, Info, Lock, Repeat, Archive as ArchiveIcon, School as SchoolIcon, TriangleAlert, X as XIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStudents } from '../hooks/useStudents';
import { useSchoolYear, type SchoolYearSchool } from '../hooks/useSchoolYear';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool } from '../api/types';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { schoolYearLabel, nextSchoolYear, schoolYearEnd } from '../utils/schoolYear';
import { plannedStartProblem } from '../../../shared/schoolYearRollover';
import { GRADES, PromoteAssign } from './PromoteAssign';

// ─── Update School Year ──────────────────────────────────────────────────────
// Rules (user, 2026-10-01):
//   • Only the SYSTEM ADMIN starts a new school year, and the button starts it
//     for EVERY school at once: grade and section are cleared for all students,
//     each one's outgoing values saved to their IPTR first.
//   • A dentist or dental aide can ask, ONCE A YEAR, for their own school to
//     start early. The System Admin approves (only that school is cleared) or
//     declines. Every step shows on this page and in the Notifications module.
//   • The System Admin may set the date the next year begins, for the next year
//     only. Changing it, and starting every school, both ask for the password.
//   • Until a school has started, nobody else can create that year's IPTR --
//     enforced by the API (schoolYearController.guardNextYearIptr), not just
//     by the locks below.
// The clearing itself now runs on the server (it used to run, student by student, in
// the browser); see schoolYearController.startSchool.
//
// Still here, unchanged:
//   • Bulk Transfer -- search/select any set of students and move them to a
//     target grade+section together, or archive them. Cleared ("unassigned")
//     students surface under their own filter so nobody stays invisible.

const UNASSIGNED = '__unassigned__';

type Tab = 'promote' | 'transfer';

type Dialog =
  | { kind: 'startAll' }
  | { kind: 'startSure' }
  | { kind: 'plan' }
  | { kind: 'ask' }
  | { kind: 'approve'; school: SchoolYearSchool }
  | { kind: 'decline'; school: SchoolYearSchool };

const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtLong = (s: string) => parseYmd(s).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** One early-start request, read from the school's rollover row. A school has at
 *  most one per year, so the schools list IS the request history. */
type RequestState = 'waiting' | 'approved' | 'declined' | 'withAll';
interface RequestItem { school: SchoolYearSchool; state: RequestState; }
const requestStateOf = (s: SchoolYearSchool): RequestState | null => {
  if (!s.requestedAt) return null;
  if (s.status === 'requested') return 'waiting';
  if (s.status === 'declined') return 'declined';
  if (s.status === 'started') return s.startKind === 'early' ? 'approved' : 'withAll';
  return null;
};

const Chip = ({ tone, children }: { tone: 'green' | 'amber' | 'blue' | 'gray'; children: React.ReactNode }) => {
  const cls = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', blue: 'bg-indigo-100 text-indigo-800', gray: 'bg-slate-100 text-slate-600' }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{children}</span>;
};

const Strip = ({ tone, icon, children, actions }: { tone: 'amber' | 'blue' | 'green' | 'red'; icon?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) => {
  const cls = {
    amber: 'bg-amber-50 border-amber-300 text-amber-900',
    red: 'bg-red-50 border-red-300 text-red-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-green-50 border-green-200 text-green-900',
  }[tone];
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center ${cls}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">{icon && <span className="mt-0.5 flex-shrink-0">{icon}</span>}<div className="min-w-0">{children}</div></div>
      {actions && <div className="flex flex-shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
};

const PasswordField = ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-foreground">Your password</label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-3.5 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {/* Only offered once something has been typed: there is nothing to reveal before that. */}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            title={shown ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-gray-100 hover:text-foreground"
          >
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
};

const DialogShell = ({ icon, iconBg, title, children, onClose, busy }: { icon: React.ReactNode; iconBg: string; title: string; children: React.ReactNode; onClose: () => void; busy: boolean }) => (
  <Modal onClose={onClose} closeDisabled={busy} maxWidth="max-w-md" rounded="rounded-2xl">
    <div className="p-6">
      <div className="flex gap-3">
        <span className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl ${iconBg}`}>{icon}</span>
        <h2 className="self-center text-lg font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  </Modal>
);

const RequestCard = ({ item, toYear, compact, onApprove, onDecline }: { item: RequestItem; toYear: string; compact?: boolean; onApprove: () => void; onDecline: () => void }) => {
  const { school: s, state } = item;
  const tone = { waiting: 'border-amber-300 bg-amber-50', approved: 'border-green-200 bg-green-50', declined: 'border-border bg-slate-50', withAll: 'border-border bg-slate-50' }[state];
  const icon = state === 'waiting' ? <BellRing className="h-5 w-5 text-amber-700" />
    : state === 'declined' ? <CircleX className="h-5 w-5 text-red-700" />
    : <CircleCheck className="h-5 w-5 text-green-700" />;
  const note = state === 'approved' ? ` · Approved${s.decidedAt ? ` ${fmtStamp(s.decidedAt)}` : ''}`
    : state === 'declined' ? ` · Declined${s.decidedAt ? ` ${fmtStamp(s.decidedAt)}` : ''}`
    : state === 'withAll' ? ' · Started with all schools' : '';
  return (
    <div className={`flex gap-3 rounded-xl border p-3 ${tone}`}>
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-[13px]">
        <div><b>{s.requestedBy ?? 'A staff member'}</b> asked to start {toYear} early for <b>{s.name}</b>.</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{s.requestedAt ? fmtStamp(s.requestedAt) : ''}{note}</div>
        {state === 'waiting' && (
          <div className={`mt-2.5 flex gap-2 ${compact ? '' : ''}`}>
            <button onClick={onDecline} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-foreground hover:bg-gray-50">Decline</button>
            <button onClick={onApprove} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover">Approve for this school</button>
          </div>
        )}
      </div>
    </div>
  );
};

export const UpdateSchoolYear = () => {
  const { user, selectedSchool } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'system_admin';
  const canUse = user?.role === 'dentist' || user?.role === 'dental_aide' || isAdmin;

  const { students: allStudents, reload: reloadStudents } = useStudents();
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  useEffect(() => { apiClient.get<ApiSchool[]>('/schools').then(setSchools).catch(() => {}); }, []);

  const school = schools.find((s) => s.school_name === selectedSchool);
  const schoolId = school?._id;

  const sy = useSchoolYear(canUse);
  const fromYear = sy.status?.currentYear ?? schoolYearLabel();
  const toYear = sy.status?.nextYear ?? nextSchoolYear(fromYear);

  // This school's standing (the school in view), and the whole picture for the System Admin.
  const mySchool = sy.status?.schools.find((s) => s.name === selectedSchool) ?? null;
  const nextYearStarted = mySchool?.status === 'started';
  const allSchools = sy.status?.schools ?? [];
  const startedCount = allSchools.filter((s) => s.status === 'started').length;
  const allStarted = allSchools.length > 0 && startedCount === allSchools.length;
  const waiting = allSchools.filter((s) => s.status === 'requested');
  const toClear = allSchools.filter((s) => s.status !== 'started');
  const toClearStudents = toClear.reduce((n, s) => n + s.assigned, 0);
  const requestItems: RequestItem[] = allSchools
    .map((s) => ({ school: s, state: requestStateOf(s) }))
    .filter((r): r is RequestItem => r.state !== null)
    .sort((a, b) => (a.state === 'waiting' ? 0 : 1) - (b.state === 'waiting' ? 0 : 1)
      || new Date(b.school.requestedAt!).getTime() - new Date(a.school.requestedAt!).getTime());
  const plannedStart = sy.status?.plannedStart ?? null;

  const [tab, setTab] = useState<Tab>('promote');
  const [schoolsOpen, setSchoolsOpen] = useState(true);
  const [bellOpen, setBellOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState<'waiting' | 'answered' | 'all' | null>(null);
  const [planEditing, setPlanEditing] = useState(false);
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  // Active, non-pending roster for the school in view. Pending (offline,
  // not-yet-synced) rows have no real _id yet — every action below needs one.
  const roster = useMemo(
    () => allStudents.filter((s) => !s.pending && s.school === selectedSchool),
    [allStudents, selectedSchool],
  );
  const unassignedCount = useMemo(() => roster.filter((s) => !s.grade || !s.section).length, [roster]);

  // ── Starting the year (server-side) ──────────────────────────────────────
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [planSure, setPlanSure] = useState(false);

  const openDialog = (d: Dialog) => {
    setBellOpen(false);
    setPanelOpen(null);
    setDialog(d);
    setDialogError(null);
    setPassword('');
    setPlanSure(false);
    setPlanDate(plannedStart ?? '');
    // A date that is already set is shown first; editing is a deliberate second step.
    setPlanEditing(d.kind === 'plan' ? !plannedStart : false);
  };
  const closeDialog = () => { if (!busy) setDialog(null); };

  const planBounds = useMemo(() => {
    const first = new Date(schoolYearEnd(new Date()).getTime() + 1);
    first.setHours(0, 0, 0, 0);
    return { min: toYmd(first), max: toYmd(new Date(first.getFullYear(), 11, 31)) };
  }, []);

  /** First step of "Start for all schools": check the password, then ask once more. */
  const checkPasswordThenAskAgain = async () => {
    setBusy(true);
    setDialogError(null);
    try {
      await apiClient.post('/auth/verify-password', { password });
      setDialog({ kind: 'startSure' });
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Could not check the password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Runs one action, refreshes everything it can have changed, and reports. */
  const act = async (fn: () => Promise<unknown>, ok: string | ((r: any) => string)) => {
    setBusy(true);
    setDialogError(null);
    try {
      const result = await fn();
      toast.success(typeof ok === 'function' ? ok(result) : ok);
      setDialog(null);
      await Promise.all([sy.reload(), reloadStudents()]);
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Bulk Transfer tab ─────────────────────────────────────────────────
  const [fromGrade, setFromGrade] = useState('');
  const [fromSection, setFromSection] = useState('');
  const [targetGrade, setTargetGrade] = useState('');
  const [targetSection, setTargetSection] = useState('');
  // "+ Add new section" in the dropdown swaps it for a text field instead of
  // requiring the section to already exist somewhere in the roster.
  const [addingNewSection, setAddingNewSection] = useState(false);
  const NEW_SECTION = '__new__';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<{ moved: number; failed: string[] } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveResult, setArchiveResult] = useState<{ archived: number; failed: string[] } | null>(null);

  const gradeFiltered = useMemo(() => {
    if (fromGrade === UNASSIGNED) return roster.filter((s) => !s.grade || !s.section);
    if (fromGrade) return roster.filter((s) => s.grade === fromGrade);
    return roster;
  }, [roster, fromGrade]);

  const fromSections = useMemo(
    () => [...new Set(gradeFiltered.map((s) => s.section).filter(Boolean))].sort(),
    [gradeFiltered],
  );

  // Every section already in use anywhere at this school — the Target
  // Section dropdown picks from these rather than free text, so a typo
  // can't quietly create a near-duplicate ("Sampaguita" vs "Sampagita").
  const allSections = useMemo(
    () => [...new Set(roster.map((s) => s.section).filter(Boolean))].sort(),
    [roster],
  );

  const transferCandidates = useMemo(() => {
    let pool = gradeFiltered;
    if (fromSection) pool = pool.filter((s) => s.section === fromSection);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      pool = pool.filter((s) => s.name.toLowerCase().includes(q));
    }
    return [...pool].sort((a, b) => a.name.localeCompare(b.name));
  }, [gradeFiltered, fromSection, search]);

  // Selection resets whenever the visible candidate set changes, so a
  // "select all" made under a previous filter cannot silently apply to
  // students no longer shown.
  useEffect(() => {
    setSelected(new Set());
    setTransferResult(null);
    setArchiveResult(null);
  }, [fromGrade, fromSection, search]);

  const allVisibleSelected = transferCandidates.length > 0 && transferCandidates.every((s) => selected.has(s.id));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(transferCandidates.map((s) => s.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runTransfer = async () => {
    if (!targetGrade || selected.size === 0) return;
    setTransferring(true);
    setTransferResult(null);
    let moved = 0;
    const failed: string[] = [];
    for (const id of selected) {
      const s = roster.find((r) => r.id === id);
      if (!s) continue;
      try {
        try {
          await apiClient.post('/student-iptrs', {
            student_id: id,
            school_year: toYear,
            grade_level: targetGrade,
            section: targetSection || null,
          });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
        }
        await apiClient.put(`/students/${id}`, { grade_level: targetGrade, section: targetSection });
        moved += 1;
      } catch (err) {
        failed.push(`${s.name} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setTransferResult({ moved, failed });
    setTransferring(false);
    setSelected(new Set());
    await reloadStudents();
    if (moved > 0) toast.success(`${moved} student${moved === 1 ? '' : 's'} moved to ${targetGrade}${targetSection ? ` · ${targetSection}` : ''}.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be moved — see the summary below.`);
  };

  const runArchive = async () => {
    setArchiving(true);
    let archived = 0;
    let lastArchivedName = '';
    const failed: string[] = [];
    for (const id of selected) {
      const s = roster.find((r) => r.id === id);
      try {
        await apiClient.patch(`/students/${id}/archive`);
        archived += 1;
        lastArchivedName = s?.name ?? '';
      } catch (err) {
        failed.push(`${s?.name ?? id} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setArchiveResult({ archived, failed });
    setArchiving(false);
    setShowArchiveConfirm(false);
    setSelected(new Set());
    await reloadStudents();
    if (archived > 0) toast.success(archived === 1 && lastArchivedName ? `${lastArchivedName} is archived.` : `${archived} student${archived === 1 ? ' is' : 's are'} archived.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be archived — see the summary below.`);
  };

  const field = 'border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring';

  // ── Guards ────────────────────────────────────────────────────────────
  const backLink = (
    <Link to="/patients" aria-label="Back to Students" title="Back to Students" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-gray-100 hover:text-foreground">
      <ArrowLeft className="h-5 w-5" />
    </Link>
  );

  if (!canUse) {
    return (
      <div className="space-y-4">
        {backLink}
        <Notice variant="error">Updating the school year is limited to the dentist, dental aide and system admin.</Notice>
      </div>
    );
  }

  // The System Admin sees every school; everyone else works on the school in view.
  if (!isAdmin && !selectedSchool) {
    return (
      <div className="space-y-4">
        {backLink}
        {/* ⚠ The way out is a button, not a sentence: the school is picked on
            Switch School, and a gate that only describes that looks broken. */}
        <Notice variant="warning">
          This runs one school at a time, and you are viewing <strong>All schools</strong>. Choose a school to continue.
        </Notice>
        <Link to="/select-school" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-hover">
          <SchoolIcon className="h-4 w-4" /> Switch School
        </Link>
      </div>
    );
  }

  const staffStatus = mySchool?.status ?? 'not_started';
  const nextChip = isAdmin
    ? allStarted ? <Chip tone="green"><CircleCheck className="h-3.5 w-3.5" /> Started</Chip>
      : startedCount > 0 ? <Chip tone="blue">{startedCount} of {allSchools.length} started</Chip>
      : <Chip tone="amber"><Clock className="h-3.5 w-3.5" /> Not started</Chip>
    : staffStatus === 'started' ? <Chip tone="green"><CircleCheck className="h-3.5 w-3.5" /> Started</Chip>
      : staffStatus === 'requested' ? <Chip tone="amber"><Hourglass className="h-3.5 w-3.5" /> Request sent</Chip>
      : <Chip tone="amber"><Clock className="h-3.5 w-3.5" /> Not started</Chip>;

  const heroText = isAdmin
    ? allStarted
      ? <>{toYear} has started for all {allSchools.length} schools.</>
      : <>Starting {toYear} clears grade and section for <b>all students in {toClear.length === allSchools.length ? `all ${allSchools.length}` : toClear.length} {plural(toClear.length, 'school')}</b>. Each student's {fromYear} grade and section are saved to their record first.</>
    : staffStatus === 'started'
      ? <>{toYear} has started for {selectedSchool}. You can now move students up.</>
      : <>The System Admin starts {toYear} for every school{plannedStart ? <> on {fmtLong(plannedStart)}</> : ''}. Need it sooner? You can ask the System Admin to start it early for <b>your school only</b>, once a year.</>;

  return (
    <div className="space-y-4">
      {/* Arrow and title share one row; the title is centred on the arrow. */}
      <div>
        <div className="flex items-center gap-2">
          {backLink}
          <h1 className="text-2xl font-bold leading-none text-primary">Update School Year</h1>
          {isAdmin && (
            <div className="relative ml-auto mr-3 sm:mr-5">
              <button
                type="button"
                onClick={() => setBellOpen((o) => !o)}
                aria-label={`Early start requests${waiting.length ? `, ${waiting.length} waiting` : ''}`}
                aria-expanded={bellOpen}
                className={`grid h-12 w-12 place-items-center rounded-xl border text-primary ${bellOpen ? 'border-primary bg-indigo-50' : 'border-border bg-card hover:bg-gray-50'}`}
              >
                <Bell className="h-6 w-6" />
              </button>
              {waiting.length > 0 && (
                <span className="pointer-events-none absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full border-2 border-white bg-red-600 px-1.5 text-xs font-bold leading-none text-white">{waiting.length}</span>
              )}
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 top-14 z-40 w-[min(390px,calc(100vw-2rem))] space-y-2.5 rounded-2xl border border-border bg-card p-3.5 shadow-xl">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      Early start requests
                      {waiting.length > 0 && <Chip tone="amber">{waiting.length} waiting</Chip>}
                    </div>
                    {requestItems.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">No requests yet.</p>}
                    {requestItems.slice(0, 3).map((r) => (
                      <RequestCard key={r.school.id} item={r} toYear={toYear} compact
                        onApprove={() => openDialog({ kind: 'approve', school: r.school })}
                        onDecline={() => openDialog({ kind: 'decline', school: r.school })} />
                    ))}
                    <button
                      type="button"
                      onClick={() => { setBellOpen(false); setPanelOpen(waiting.length ? 'waiting' : 'all'); }}
                      className="flex w-full items-center justify-center gap-1.5 pt-1 text-sm font-bold text-primary hover:underline"
                    >
                      See all requests <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 pl-11 text-sm text-muted-foreground">
          {isAdmin ? 'All schools' : selectedSchool} · {fromYear} <ArrowRight className="h-3.5 w-3.5" /> {toYear}
        </p>
      </div>

      {sy.error && <Notice variant="error">{sy.error}</Notice>}

      {/* Everyone else: where their one request stands */}
      {!isAdmin && staffStatus === 'requested' && (
        <Strip tone="amber" icon={<Hourglass className="h-5 w-5 text-amber-700" />} actions={<Chip tone="amber">Waiting</Chip>}>
          <b>Request sent</b>{mySchool?.requestedAt ? <> {fmtStamp(mySchool.requestedAt)}</> : ''}. Waiting for the System Admin.
        </Strip>
      )}
      {!isAdmin && staffStatus === 'declined' && (
        <Strip tone="blue" icon={<CircleX className="h-5 w-5 text-red-700" />} actions={<Chip tone="gray">Used</Chip>}>
          <b>Declined.</b> You have used this year's early request. {toYear} starts for every school{plannedStart ? <> on {fmtLong(plannedStart)}</> : ''}.
        </Strip>
      )}
      {!isAdmin && staffStatus === 'started' && (
        <Strip tone="green" icon={<CircleCheck className="h-5 w-5 text-green-700" />} actions={<Chip tone="green">Started</Chip>}>
          <b>{mySchool?.startKind === 'early' ? 'Approved.' : `${toYear} has started.`}</b> {mySchool?.startKind === 'early' ? `${toYear} has started for your school.` : 'You can now move students up.'}
        </Strip>
      )}

      {/* The banner: now -> next, the planned date, and the one big action */}
      <div className="rounded-2xl p-5 text-white sm:p-7" style={{ background: 'linear-gradient(135deg,#1e2c63,#273a78)' }}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <div className="text-xs font-bold tracking-widest text-white/70">NOW</div>
            <div className="text-2xl font-extrabold sm:text-3xl">{fromYear.replace('-', '–')}</div>
            <div className="mt-1"><Chip tone="green"><CircleCheck className="h-3.5 w-3.5" /> Running</Chip></div>
          </div>
          <ArrowRight className="hidden h-8 w-8 text-white/60 sm:block" />
          <div>
            <div className="text-xs font-bold tracking-widest text-white/70">NEXT</div>
            <div className="text-2xl font-extrabold sm:text-3xl">{toYear.replace('-', '–')}</div>
            <div className="mt-1">{nextChip}</div>
          </div>
          <div className="sm:ml-auto sm:text-right">
            <div className="text-xs text-white/75">{isAdmin ? 'Planned start for all schools' : 'Planned start'}</div>
            <div className="my-1 text-base font-extrabold">{plannedStart ? fmtLong(plannedStart) : 'Not set yet'}</div>
            {isAdmin && !allStarted && (
              <button onClick={() => openDialog({ kind: 'plan' })} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-primary hover:bg-white/90">
                <Lock className="h-4 w-4" /> {plannedStart ? 'Change date' : 'Set date'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-xs text-white/90">{heroText}</p>
          {isAdmin && !allStarted && (
            <button onClick={() => openDialog({ kind: 'startAll' })} disabled={!sy.status} className="flex-shrink-0 rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">
              Start new school year for all schools
            </button>
          )}
          {!isAdmin && staffStatus === 'not_started' && (
            <button onClick={() => openDialog({ kind: 'ask' })} disabled={!mySchool} className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-primary hover:bg-white/90 disabled:opacity-50">
              <Bell className="h-4 w-4" /> Ask to start early
            </button>
          )}
          {!isAdmin && (staffStatus === 'requested' || staffStatus === 'declined') && (
            <span className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-white/15 px-5 py-2.5 text-sm font-bold text-white/80">
              <Lock className="h-4 w-4" /> {staffStatus === 'requested' ? 'Request sent' : 'Request used'}
            </span>
          )}
        </div>
      </div>

      {/* System Admin: how each school stands */}
      {isAdmin && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setSchoolsOpen((o) => !o)}
            aria-expanded={schoolsOpen}
            className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 ${schoolsOpen ? 'border-b border-border' : ''}`}
          >
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-800"><SchoolIcon className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 text-lg font-bold leading-tight text-foreground">Schools <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-100 px-1 text-[11px] font-bold text-blue-700">{allSchools.length}</span></h2>
              <p className="text-xs font-normal text-muted-foreground">The button above starts every school at once. A school can also start early if you approve its request.</p>
            </div>
            <span className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-primary">
              {schoolsOpen ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform ${schoolsOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {schoolsOpen && allSchools.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">{sy.loading ? 'Loading…' : 'No schools yet.'}</p>}
          {schoolsOpen && allSchools.map((s, i) => (
            <div key={s.id} className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${i ? 'border-t border-border/60' : ''}`}>
              <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-800"><SchoolIcon className="h-[18px] w-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-foreground">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.students} {plural(s.students, 'student')}</div>
              </div>
              {s.status === 'started' && <Chip tone="green">Started{s.startKind === 'early' ? ' early' : ''}</Chip>}
              {s.status === 'requested' && <Chip tone="amber"><Hourglass className="h-3 w-3" /> Early request</Chip>}
              {s.status === 'declined' && <Chip tone="gray">Request declined</Chip>}
              {s.status === 'not_started' && <Chip tone="gray">Not started</Chip>}
              {s.status === 'requested' && (
                <div className="flex gap-2">
                  <button onClick={() => openDialog({ kind: 'decline', school: s })} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-foreground hover:bg-gray-50">Decline</button>
                  <button onClick={() => openDialog({ kind: 'approve', school: s })} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover">Approve</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Moving students: one school at a time */}
      {!selectedSchool ? (
        <Notice variant="warning">To move students up or between sections, choose a school with Switch School.</Notice>
      ) : (
        <>
          {nextYearStarted && unassignedCount > 0 && (
            <button
              onClick={() => { setTab('transfer'); setFromGrade(UNASSIGNED); setFromSection(''); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              {unassignedCount} student{unassignedCount === 1 ? '' : 's'} unassigned for {toYear} — view them
            </button>
          )}

          <div className="flex gap-1 border-b border-border">
            <button
              onClick={() => setTab('promote')}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${tab === 'promote' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <GraduationCap className="h-4 w-4" /> Assign
            </button>
            <button
              onClick={() => setTab('transfer')}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${tab === 'transfer' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Repeat className="h-4 w-4" /> Bulk Assignment
            </button>
          </div>

          {tab === 'promote' && (
            <div className="rounded-xl border border-border bg-card">
              <PromoteAssign onClose={() => void reloadStudents()} schoolId={schoolId} schoolName={selectedSchool} nextYearStarted={nextYearStarted} unassignedCount={unassignedCount} onShowUnassigned={nextYearStarted ? () => { setTab('transfer'); setFromGrade(UNASSIGNED); setFromSection(''); } : undefined} />
            </div>
          )}

          {tab === 'transfer' && !nextYearStarted && (
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>Bulk Assignment opens when {toYear} starts for {selectedSchool}. {isAdmin ? 'Start the school year above, or approve this school\'s request.' : 'Ask the System Admin to start it early, or wait for the planned start.'}</p>
            </div>
          )}

      {tab === 'transfer' && nextYearStarted && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          {/* Actions sit at the right end of this row rather than under the
              roster: same reason as the Assign tab, and `items-end` already
              bottom-aligns everything here so they line up with the selects. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">From Grade</label>
              <select value={fromGrade} onChange={(e) => { setFromGrade(e.target.value); setFromSection(''); }} className={field}>
                <option value="">All Grades</option>
                <option value={UNASSIGNED}>Unassigned (no grade/section)</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">From Section</label>
              <select value={fromSection} onChange={(e) => setFromSection(e.target.value)} className={field} disabled={fromGrade === UNASSIGNED}>
                <option value="">All Sections</option>
                {fromSections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Target Grade *</label>
              <select value={targetGrade} onChange={(e) => setTargetGrade(e.target.value)} className={field}>
                <option value="">Select grade…</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Target Section</label>
              {addingNewSection ? (
                <div className="flex items-center gap-1">
                  <input
                    value={targetSection}
                    onChange={(e) => setTargetSection(e.target.value)}
                    placeholder="New section name"
                    autoFocus
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={() => { setAddingNewSection(false); setTargetSection(''); }}
                    title="Cancel — pick from the list instead"
                    className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground px-2 py-2"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <select
                  value={targetSection}
                  onChange={(e) => {
                    if (e.target.value === NEW_SECTION) { setAddingNewSection(true); setTargetSection(''); }
                    else setTargetSection(e.target.value);
                  }}
                  className={field}
                >
                  <option value="">No section</option>
                  {allSections.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value={NEW_SECTION}>+ Add new section…</option>
                </select>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowArchiveConfirm(true)}
                disabled={selected.size === 0 || archiving || transferring}
                className="flex items-center justify-center gap-2 px-4 py-2 border border-destructive text-destructive rounded-lg text-sm font-medium hover:bg-danger-surface disabled:opacity-50"
              >
                <ArchiveIcon className="w-4 h-4" /> Archive Selected
              </button>
              <button
                onClick={runTransfer}
                disabled={selected.size === 0 || !targetGrade || transferring || archiving}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50"
              >
                {transferring ? 'Working…' : `Transfer Selected (${selected.size})`}
              </button>
            </div>
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className={`w-full ${field}`}
          />

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 font-medium text-foreground">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-primary" />
              Select All ({transferCandidates.length})
            </label>
            <span className="text-muted-foreground">{selected.size} student{selected.size === 1 ? '' : 's'} selected</span>
          </div>

          <div className="border border-border rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Student Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Current Grade</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Current Section</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-primary">Target Grade</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-primary">Target Section</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transferCandidates.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No students match.</td></tr>
                ) : transferCandidates.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} className="w-4 h-4 accent-primary" aria-label={`Select ${s.name}`} />
                    </td>
                    <td className="px-3 py-2 text-foreground">{s.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.grade || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.section || '—'}</td>
                    <td className="px-3 py-2">
                      {targetGrade
                        ? <span className="inline-flex px-2 py-0.5 rounded-full bg-primary-surface text-primary text-xs font-semibold">{targetGrade}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {targetSection
                        ? <span className="inline-flex px-2 py-0.5 rounded-full bg-primary-surface text-primary text-xs font-semibold">{targetSection}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transferResult && (
            <Notice variant={transferResult.failed.length ? 'error' : 'success'}>
              {transferResult.moved} moved to {toYear}.
              {transferResult.failed.length > 0 && (
                <ul className="mt-1 list-disc list-inside">{transferResult.failed.map((f) => <li key={f}>{f}</li>)}</ul>
              )}
            </Notice>
          )}
          {archiveResult && (
            <Notice variant={archiveResult.failed.length ? 'error' : 'success'}>
              {archiveResult.archived} archived.
              {archiveResult.failed.length > 0 && (
                <ul className="mt-1 list-disc list-inside">{archiveResult.failed.map((f) => <li key={f}>{f}</li>)}</ul>
              )}
            </Notice>
          )}

        </div>
      )}

        </>
      )}

      {/* ── Every early-start request (opened from the bell) ───────────── */}
      {isAdmin && panelOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/40" onClick={() => setPanelOpen(null)}>
          <aside
            role="dialog"
            aria-label="Early start requests"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[430px] flex-col gap-3 overflow-y-auto bg-card p-5 shadow-2xl"
          >
            <div className="flex items-center">
              <h2 className="text-base font-bold text-foreground">Early start requests</h2>
              <button type="button" onClick={() => setPanelOpen(null)} aria-label="Close" className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-gray-100"><XIcon className="h-5 w-5" /></button>
            </div>
            <div className="flex gap-2">
              {([['waiting', `Waiting · ${requestItems.filter((r) => r.state === 'waiting').length}`], ['answered', `Answered · ${requestItems.filter((r) => r.state !== 'waiting').length}`], ['all', `All · ${requestItems.length}`]] as const).map(([k, t]) => (
                <button key={k} type="button" onClick={() => setPanelOpen(k)} aria-pressed={panelOpen === k}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${panelOpen === k ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}>{t}</button>
              ))}
            </div>
            {requestItems.filter((r) => panelOpen === 'all' || (panelOpen === 'waiting' ? r.state === 'waiting' : r.state !== 'waiting')).map((r) => (
              <RequestCard key={r.school.id} item={r} toYear={toYear}
                onApprove={() => openDialog({ kind: 'approve', school: r.school })}
                onDecline={() => openDialog({ kind: 'decline', school: r.school })} />
            ))}
            {requestItems.filter((r) => panelOpen === 'all' || (panelOpen === 'waiting' ? r.state === 'waiting' : r.state !== 'waiting')).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{panelOpen === 'waiting' ? 'No requests are waiting.' : 'Nothing here yet.'}</p>
            )}
          </aside>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      {dialog?.kind === 'startAll' && (
        <DialogShell title={`Start ${toYear} for all schools?`} icon={<GraduationCap className="h-5 w-5 text-rose-700" />} iconBg="bg-rose-100" onClose={closeDialog} busy={busy}>
          <p className="mt-3 text-sm text-muted-foreground">Grade and section will be cleared for every student below. Each one's {fromYear} grade and section are saved to their IPTR first. This cannot be undone from this screen.</p>
          {/* Only the school list scrolls (from the 11th school on); the total stays in view. */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border text-sm">
            <div className="max-h-[370px] overflow-y-auto">
              {toClear.map((s, i) => (
                <div key={s.id} className={`flex justify-between gap-3 px-3.5 py-2 ${i ? 'border-t border-border/60' : ''}`}><span className="min-w-0 truncate">{s.name}</span><b>{s.assigned}</b></div>
              ))}
            </div>
            <div className="flex justify-between border-t border-border bg-slate-50 px-3.5 py-2.5 font-extrabold"><span>All schools</span><span>{toClearStudents} {plural(toClearStudents, 'student')}</span></div>
          </div>
          <PasswordField id="sy-startall-pw" value={password} onChange={setPassword} />
          {dialogError && <div className="mt-3"><Notice variant="error">{dialogError}</Notice></div>}
          <div className="mt-5 flex gap-2">
            <button onClick={closeDialog} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">Cancel</button>
            <button
              onClick={() => void checkPasswordThenAskAgain()}
              disabled={busy || !password}
              className="flex-[1.4] rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Start for all schools'}
            </button>
          </div>
        </DialogShell>
      )}

      {dialog?.kind === 'startSure' && (
        <DialogShell title="Are you really sure?" icon={<TriangleAlert className="h-5 w-5 text-red-700" />} iconBg="bg-red-100" onClose={closeDialog} busy={busy}>
          <div className="mt-4"><Strip tone="red">
            You are about to start <b>{toYear}</b> for <b>all {toClear.length} {plural(toClear.length, 'school')}</b>. Grade and section will be cleared for <b>{toClearStudents} {plural(toClearStudents, 'student')}</b> right now.
          </Strip></div>
          <p className="mt-3 text-sm text-muted-foreground">Each student's {fromYear} grade and section stay saved in their IPTR, but nobody can undo the clearing from this screen.</p>
          {dialogError && <div className="mt-3"><Notice variant="error">{dialogError}</Notice></div>}
          <div className="mt-5 flex gap-2">
            <button onClick={() => { setDialogError(null); setDialog({ kind: 'startAll' }); }} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">No, go back</button>
            <button
              onClick={() => void act(() => sy.startAll(password), (r) => `${toYear} started for ${r.schoolsStarted} ${plural(r.schoolsStarted, 'school')}. ${r.studentsCleared} ${plural(r.studentsCleared, 'student')} cleared.`)}
              disabled={busy}
              className="flex-[1.4] rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Yes, start all schools'}
            </button>
          </div>
        </DialogShell>
      )}

      {dialog?.kind === 'plan' && (
        <DialogShell title={planEditing ? 'Change the start date' : 'Start date'} icon={<CalendarDays className="h-5 w-5 text-red-700" />} iconBg="bg-red-100" onClose={closeDialog} busy={busy}>
          <div className="mt-4"><Strip tone="red" icon={<TriangleAlert className="h-5 w-5 text-red-700" />}>This is a big decision. It sets the start date for {toYear} at every school. It can only be set for the next school year.</Strip></div>
          {!planEditing ? (
            <>
              {/* A date that is already set is shown first; changing it is a second, deliberate step. */}
              <div className="mt-4 rounded-xl border border-border bg-slate-50 px-4 py-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current start date</div>
                <div className="mt-1 text-lg font-extrabold text-foreground">{plannedStart ? fmtLong(plannedStart) : 'Not set yet'}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">For {toYear}, at every school.</div>
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={closeDialog} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50">Close</button>
                <button onClick={() => setPlanEditing(true)} className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover">
                  <Lock className="h-4 w-4" /> Edit date
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-4">
                <label htmlFor="sy-plan-date" className="mb-1.5 block text-sm font-semibold text-foreground">New start date</label>
                <input id="sy-plan-date" type="date" min={planBounds.min} max={planBounds.max} value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                {planDate && plannedStartProblem(planDate) && <p className="mt-1.5 text-xs text-destructive">{plannedStartProblem(planDate)}</p>}
              </div>
              <label className="mt-4 flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={planSure} onChange={(e) => setPlanSure(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                <span>I understand {toYear} will begin on this date.</span>
              </label>
              <PasswordField id="sy-plan-pw" value={password} onChange={setPassword} />
              {dialogError && <div className="mt-3"><Notice variant="error">{dialogError}</Notice></div>}
              <div className="mt-5 flex gap-2">
                <button onClick={plannedStart ? () => { setPlanEditing(false); setDialogError(null); } : closeDialog} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">{plannedStart ? 'Back' : 'Cancel'}</button>
                <button
                  onClick={() => void act(() => sy.setPlan(planDate, password), `${toYear} will begin on ${planDate ? fmtLong(planDate) : ''}.`)}
                  disabled={busy || !planSure || !password || !planDate || !!plannedStartProblem(planDate)}
                  className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" /> {busy ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </>
          )}
        </DialogShell>
      )}

      {dialog?.kind === 'ask' && mySchool && (
        <DialogShell title={`Ask to start ${toYear} early?`} icon={<Bell className="h-5 w-5 text-primary" />} iconBg="bg-indigo-100" onClose={closeDialog} busy={busy}>
          <p className="mt-3 text-sm text-muted-foreground">The System Admin will be notified. If they approve, grade and section are cleared for <b className="text-foreground">{mySchool.name}</b> only.</p>
          <div className="mt-4"><Strip tone="red" icon={<TriangleAlert className="h-5 w-5 text-red-700" />}>You can ask <b>once a year</b>. You will not be able to send another request for {toYear}.</Strip></div>
          {dialogError && <div className="mt-3"><Notice variant="error">{dialogError}</Notice></div>}
          <div className="mt-5 flex gap-2">
            <button onClick={closeDialog} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">Cancel</button>
            <button onClick={() => void act(() => sy.requestEarly(mySchool.id), 'Request sent. The System Admin has been notified.')} disabled={busy} className="flex-[1.4] rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50">
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </DialogShell>
      )}

      {dialog?.kind === 'approve' && (
        <DialogShell title="Approve the early start?" icon={<BellRing className="h-5 w-5 text-amber-700" />} iconBg="bg-amber-100" onClose={closeDialog} busy={busy}>
          <p className="mt-3 text-sm text-muted-foreground"><b className="text-foreground">{dialog.school.name}</b> will start {toYear} now. Grade and section are cleared for its <b className="text-foreground">{dialog.school.assigned} {plural(dialog.school.assigned, 'student')} only</b>. Other schools are not affected.</p>
          {dialog.school.requestedBy && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" /> Requested by {dialog.school.requestedBy}{dialog.school.requestedAt ? ` on ${fmtStamp(dialog.school.requestedAt)}` : ''}.</p>}
          {dialogError && <div className="mt-3"><Notice variant="error">{dialogError}</Notice></div>}
          <div className="mt-5 flex gap-2">
            <button onClick={closeDialog} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-gray-50 disabled:opacity-60">Cancel</button>
            <button
              onClick={() => void act(() => sy.approve(dialog.school.requestId!), (r) => `${toYear} started for ${dialog.school.name}. ${r.studentsCleared} ${plural(r.studentsCleared, 'student')} cleared.`)}
              disabled={busy || !dialog.school.requestId}
              className="flex-[1.4] rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Approve for this school'}
            </button>
          </div>
        </DialogShell>
      )}

      <ConfirmDialog
        open={dialog?.kind === 'decline'}
        title="Decline the early start?"
        message={dialog?.kind === 'decline' ? <>{dialog.school.name} will start {toYear} with every other school on the planned date. This uses up its one request for the year.</> : ''}
        confirmLabel="Decline request"
        tone="danger"
        busy={busy}
        onConfirm={() => { if (dialog?.kind === 'decline') void act(() => sy.decline(dialog.school.requestId!), 'Request declined.'); }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={showArchiveConfirm}
        title={`Archive ${selected.size} student${selected.size === 1 ? '' : 's'}?`}
        message="Archived students are removed from active rosters and reports. A System Admin can restore them later from Archived Records."
        confirmLabel="Archive"
        tone="danger"
        busy={archiving}
        onConfirm={runArchive}
        onCancel={() => setShowArchiveConfirm(false)}
      />
    </div>
  );
};
