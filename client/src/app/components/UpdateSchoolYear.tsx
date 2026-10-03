import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, GraduationCap, Repeat, Archive as ArchiveIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStudents } from '../hooks/useStudents';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool } from '../api/types';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { schoolYearLabel, nextSchoolYear } from '../utils/schoolYear';
import { GRADES, PromoteAssign } from './PromoteAssign';

// ─── Update School Year ──────────────────────────────────────────────────────
// Replaces the old "Promote / Assign" entry point. Two things live here that
// didn't before:
//   • "Start New School Year" — a school-wide clear of grade/section, for the
//     April/May rollover when the whole roster needs a clean slate rather than
//     one grade at a time. Each student's OUTGOING grade/section is written to
//     their STUDENT_IPTR for the year just ending first, so the history survives
//     the clear (same "STUDENT = current enrolment, STUDENT_IPTR = per-year
//     record" split PromoteAssign already uses, just run backward-in-time).
//   • Bulk Transfer — search/select any set of students and move them to a
//     target grade+section together, or archive them, without picking a
//     single existing grade first. Cleared ("unassigned") students surface
//     under their own filter so nobody stays invisible after the clear.
//
// No new persisted setting for "when" the school year turns over — the user
// confirmed the existing School Year picker (schoolYearLabel/nextSchoolYear)
// is enough; DepEd's June–April calendar is already encoded there.

const UNASSIGNED = '__unassigned__';

type Tab = 'promote' | 'transfer';

export const UpdateSchoolYear = () => {
  const { user, selectedSchool } = useAuth();
  const toast = useToast();
  const canUse = user?.role === 'dentist' || user?.role === 'dental_aide';

  const { students: allStudents, reload: reloadStudents } = useStudents();
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  useEffect(() => { apiClient.get<ApiSchool[]>('/schools').then(setSchools).catch(() => {}); }, []);

  const school = schools.find((s) => s.school_name === selectedSchool);
  const schoolId = school?._id;

  const fromYear = schoolYearLabel();
  const toYear = nextSchoolYear(fromYear);

  // "Start New School Year" is normally only clickable March-August — the
  // real rollover window — unless a System Admin has flipped this school's
  // override on (see SchoolManagement). getMonth() is 0-indexed: 2=March,
  // 7=August.
  const inRolloverSeason = (() => { const m = new Date().getMonth(); return m >= 2 && m <= 7; })();
  const overrideAllowed = school?.allow_school_year_override === true;
  const canStartSchoolYear = inRolloverSeason || overrideAllowed;

  const [tab, setTab] = useState<Tab>('promote');

  // Active, non-pending roster for the school in view. Pending (offline,
  // not-yet-synced) rows have no real _id yet — every action below needs one.
  const roster = useMemo(
    () => allStudents.filter((s) => !s.pending && s.school === selectedSchool),
    [allStudents, selectedSchool],
  );
  const unassignedCount = useMemo(() => roster.filter((s) => !s.grade || !s.section).length, [roster]);
  const stillAssignedCount = useMemo(() => roster.filter((s) => s.grade || s.section).length, [roster]);

  // ── Start New School Year (clear + preserve history) ────────────────────
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeProgress, setWipeProgress] = useState(0);
  const [wipeResult, setWipeResult] = useState<{ cleared: number; failed: string[] } | null>(null);

  const runWipe = async () => {
    setWiping(true);
    setWipeResult(null);
    setWipeProgress(0);
    const toClear = roster.filter((s) => s.grade || s.section);
    let cleared = 0;
    const failed: string[] = [];
    for (const s of toClear) {
      try {
        // Snapshot the OUTGOING year first. A 409 means one already exists for
        // fromYear (opened at intake, per Sprint 69) — that already carries the
        // truth, so it is left alone rather than overwritten.
        try {
          await apiClient.post('/student-iptrs', {
            student_id: s.id,
            school_year: fromYear,
            grade_level: s.grade,
            section: s.section || null,
          });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
        }
        await apiClient.put(`/students/${s.id}`, { grade_level: '', section: '' });
        cleared += 1;
      } catch (err) {
        failed.push(`${s.name} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
      setWipeProgress((p) => p + 1);
    }
    setWipeResult({ cleared, failed });
    setWiping(false);
    setShowWipeConfirm(false);
    await reloadStudents();
    if (cleared > 0) toast.success(`${cleared} student${cleared === 1 ? '' : 's'} cleared for ${toYear}. Their ${fromYear} grade and section are recorded in their IPTR.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be cleared — see the summary below.`);
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
    const failed: string[] = [];
    for (const id of selected) {
      const s = roster.find((r) => r.id === id);
      try {
        await apiClient.patch(`/students/${id}/archive`);
        archived += 1;
      } catch (err) {
        failed.push(`${s?.name ?? id} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setArchiveResult({ archived, failed });
    setArchiving(false);
    setShowArchiveConfirm(false);
    setSelected(new Set());
    await reloadStudents();
    if (archived > 0) toast.success(`${archived} student${archived === 1 ? '' : 's'} archived.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be archived — see the summary below.`);
  };

  const field = 'border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring';

  // ── Guards ────────────────────────────────────────────────────────────
  if (!canUse) {
    return (
      <div className="space-y-4">
        <Link to="/patients" aria-label="Back to Students" title="Back to Students" className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Notice variant="error">Updating the school year is limited to the dentist and dental aide.</Notice>
      </div>
    );
  }

  if (!selectedSchool) {
    return (
      <div className="space-y-4">
        <Link to="/patients" aria-label="Back to Students" title="Back to Students" className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Notice variant="warning">Pick a specific school from the Students page first — this runs one school at a time.</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/patients" aria-label="Back to Students" title="Back to Students" className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-primary mt-2">Update School Year</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {selectedSchool} · {fromYear} <Repeat className="w-3 h-3 inline mx-1" /> {toYear}
        </p>
      </div>

      {/* Start New School Year — the school-wide clear. Idempotent: already-
          cleared students (empty grade/section) are simply not touched, so
          re-running it after some reassignment has already happened is safe. */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">Start {toYear}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {!canStartSchoolYear
                ? `Only available March–August. A System Admin can enable it for this school any time from School Management.`
                : stillAssignedCount > 0
                  ? `Clears grade and section for ${stillAssignedCount} student${stillAssignedCount === 1 ? '' : 's'} still carrying their ${fromYear} assignment. Each one's ${fromYear} grade and section is saved to their IPTR first.`
                  : `Every active student here has already been cleared for ${toYear}.`}
            </p>
          </div>
          <button
            onClick={() => setShowWipeConfirm(true)}
            disabled={stillAssignedCount === 0 || wiping || !canStartSchoolYear}
            title={!canStartSchoolYear ? 'Only available March–August, unless a System Admin has enabled it for this school.' : undefined}
            className="flex-shrink-0 px-3 py-1.5 bg-destructive text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {wiping ? `Clearing… ${wipeProgress}/${stillAssignedCount}` : `Start New School Year (${stillAssignedCount})`}
          </button>
        </div>
        {unassignedCount > 0 && (
          <button
            onClick={() => { setTab('transfer'); setFromGrade(UNASSIGNED); setFromSection(''); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            {unassignedCount} student{unassignedCount === 1 ? '' : 's'} unassigned for {toYear} — view them
          </button>
        )}
        {wipeResult && (
          <Notice variant={wipeResult.failed.length ? 'error' : 'success'}>
            {wipeResult.cleared} cleared, saved to their {fromYear} IPTR.
            {wipeResult.failed.length > 0 && (
              <ul className="mt-1 list-disc list-inside">{wipeResult.failed.map((f) => <li key={f}>{f}</li>)}</ul>
            )}
          </Notice>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab('promote')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'promote' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <GraduationCap className="w-4 h-4" /> Assign
        </button>
        <button
          onClick={() => setTab('transfer')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'transfer' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <Repeat className="w-4 h-4" /> Bulk Assignment
        </button>
      </div>

      {tab === 'promote' && (
        <div className="bg-card rounded-xl border border-border">
          <PromoteAssign onClose={() => void reloadStudents()} schoolId={schoolId} schoolName={selectedSchool} allSections={allSections} />
        </div>
      )}

      {tab === 'transfer' && (
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

      <ConfirmDialog
        open={showWipeConfirm}
        title={`Start ${toYear} for ${selectedSchool}?`}
        message={
          <>
            This clears grade and section for all {stillAssignedCount} currently-assigned student{stillAssignedCount === 1 ? '' : 's'} at this school.
            Each one's {fromYear} grade and section is saved to their IPTR record first, so it is not lost. This cannot be undone from this screen —
            students will need to be reassigned below.
          </>
        }
        confirmLabel={`Clear ${stillAssignedCount} student${stillAssignedCount === 1 ? '' : 's'}`}
        tone="danger"
        busy={wiping}
        onConfirm={runWipe}
        onCancel={() => setShowWipeConfirm(false)}
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
