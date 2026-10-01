import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive as ArchiveIcon, ArrowRight, GraduationCap, ListChecks, Lock, Search, Users, X } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { ApiStudent, ApiStudentIptr } from '../api/types';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { schoolYearLabel } from '../utils/schoolYear';
import { surnameFirst } from '../utils/studentName';

// ─── Promote / Assign ────────────────────────────────────────────────────────
// Rollover, in one reviewed action per section instead of one edit per student.
//
// Sprint 57a put grade/section on the IPTR, 69 made intake open the year
// record, and 70 made those fields editable one at a time. This is the bulk
// version of that same edit — the piece backlog 23 called "option A" and
// deferred as a rollout feature. At ~8,000 students it is the difference between
// roughly thirty actions and eight thousand.
//
// Two records change per student, deliberately:
//   • the StudentIptr for the target year, carrying the new grade/section —
//     CREATED when there is none, or CORRECTED in place when there already is
//     one (Sprint 102). Other years are never touched.
//   • the STUDENT's own grade/section, which is CURRENT enrolment and is what
//     rosters and the appointment picker read.
//
// Sprint 102 made it RE-RUNNABLE. Before it, a student who already held the
// target year was forced to skip, so a section applied wrongly could not be
// fixed from the screen that applied it — the only way back was editing each
// student by hand, which is the work this screen exists to remove. Correcting is
// opt-in per student and never the default: a blind second pass would overwrite
// a deliberate manual fix, which is a worse failure than a visible refusal.
//
// The user's standing constraint applies: no per-record prompts or badges
// across thousands of students. One preview, one confirm, one summary.

/** Type-to-filter section box, same behaviour as Add Student. The menu is
 *  portalled and fixed-positioned so the roster table's scroll area cannot clip it. */
function SectionCombo({ value, onChange, options, disabled, ariaLabel, className }: {
  value: string; onChange: (v: string) => void; options: string[]; disabled?: boolean; ariaLabel: string; className: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = () => { if (ref.current) setRect(ref.current.getBoundingClientRect()); };
  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [rect]);
  const q = value.trim().toLowerCase();
  const shown = options.filter((o) => o.toLowerCase().startsWith(q));
  return (
    <>
      <input
        ref={ref}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); open(); }}
        onFocus={open}
        onBlur={() => setRect(null)}
        placeholder="Section"
        autoComplete="off"
        aria-label={ariaLabel}
        className={className}
      />
      {rect && !disabled && (shown.length > 0 || q) && createPortal(
        <div style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 160), zIndex: 60 }} className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card text-[14.5px] shadow-md">
          {shown.map((o) => (
            <button key={o} type="button" onMouseDown={() => { onChange(o); setRect(null); }} className="block w-full px-3 py-2 text-left text-foreground hover:bg-gray-50">{o}</button>
          ))}
          {q && !options.some((o) => o.toLowerCase() === q) && (
            <button type="button" onMouseDown={() => setRect(null)} className={`block w-full px-3 py-2 text-left text-primary hover:bg-primary/5 ${shown.length ? 'border-t border-border' : ''}`}>+ Add "{value.trim()}" as new section</button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Pseudo-grade for the "no grade or section yet" shortcut. */
const UNASSIGNED = '__unassigned__';

export const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];

/** The grade after `g`, or null for the exit year (Grade 10 leaves). */
const nextGrade = (g: string): string | null => {
  const i = GRADES.indexOf(g);
  return i >= 0 && i < GRADES.length - 1 ? GRADES[i + 1] : null;
};

/** "2026-2027" → "2027-2028". */
const nextSchoolYear = (sy: string): string => {
  const [a, b] = sy.split('-').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? `${a + 1}-${b + 1}` : sy;
};

/** promote = next grade; retain = repeat grade and section; skipgrade = two grades up. */
type Action = 'promote' | 'retain' | 'skipgrade';

/** The grade `steps` above `g`, or null when there is none. */
const gradeAbove = (g: string, steps: number): string | null => {
  const i = GRADES.indexOf(g);
  return i >= 0 && i + steps < GRADES.length ? GRADES[i + steps] : null;
};
/** The grade a student lands in for an action; null when the action is not possible for them. */
const gradeFor = (current: string, a: Action): string | null =>
  a === 'retain' ? (current || null) : gradeAbove(current, a === 'promote' ? 1 : 2);
const ACTION_LABEL: Record<Action, string> = { promote: 'Promote', retain: 'Retain', skipgrade: 'Skip a grade' };

interface RowState {
  student: ApiStudent;
  action: Action;
  /** Section for the new year — defaults to the one they are in now. */
  section: string;
  /** Already has a record for the target year. Before Sprint 102 this forced
   *  `skip` and the row was uneditable, so a section applied wrongly could
   *  NOT be fixed from the screen that applied it. */
  alreadyHasYear: boolean;
  /** The target-year IPTR when one exists — what `update` writes to. */
  existingIptr?: ApiStudentIptr;
}

export const PromoteAssign = ({ onClose, schoolId, schoolName, nextYearStarted = true, unassignedCount = 0, onShowUnassigned, fixedMode }: {
  onClose: () => void;
  /** Which job this instance does. The two jobs live on separate tabs, so there is no in-panel switch. */
  fixedMode: 'promote' | 'transfer';
  schoolId: string | undefined;
  schoolName: string;
  /** Students at this school with no grade or section yet, and a way to list them
   *  (Bulk Assignment, filtered to "Unassigned"). Both optional: without them the
   *  shortcut simply is not shown. */
  unassignedCount?: number;
  onShowUnassigned?: () => void;
  /** False until the School Year has been started for this school (by the
   *  System Admin, for every school or by approving a request). Promoting opens
   *  the next year's records, which the server refuses before then, so the
   *  button is locked here rather than left to fail. Defaults to true so any
   *  other caller is unchanged. */
  nextYearStarted?: boolean;
}) => {
  const toast = useToast();
  const fromYear = schoolYearLabel();
  const toYear = nextSchoolYear(fromYear);

  // Two jobs on one screen, deliberately separate:
  //  · promote  — opens NEXT year's record (the Sprint 74 flow)
  //  · transfer — moves students between grade/section WITHIN the current year,
  //    creating no year record at all. Requested 2026-09-04: "sections can
  //    change mid year", so a reshuffle of 30 students was 30 separate edits.
  const mode = fixedMode;
  const [transferGrade, setTransferGrade] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [iptrs, setIptrs] = useState<ApiStudentIptr[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; corrected: number; skipped: number; failed: string[] } | null>(null);

  // The roster for one school + grade, server-filtered (Sprint 56's
  // filterable/filterableText) rather than pulling every student.
  useEffect(() => {
    if (!schoolId || !grade) { setStudents([]); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ school_id: schoolId });
    if (grade !== UNASSIGNED) params.set('grade_level', grade);
    apiClient.get<ApiStudent[]>(`/students?${params}`)
      .then((rows) => { if (!cancelled) setStudents(grade === UNASSIGNED ? rows.filter((x) => !x.grade_level || !x.section) : rows); })
      .catch(() => { if (!cancelled) setStudents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId, grade]);

  // Which of them already have the TARGET year. Those rows become correctable
  // rather than blocked (Sprint 102) — a POST would still 409 on uniqueBy
  // (student_id + school_year), so they are PUT to their existing record.
  useEffect(() => {
    if (students.length === 0) { setIptrs([]); return; }
    let cancelled = false;
    const ids = students.map((s) => s._id).slice(0, 200).join(',');
    apiClient.get<ApiStudentIptr[]>(`/student-iptrs?student_id=${ids}`)
      .then((rows) => { if (!cancelled) setIptrs(rows); })
      .catch(() => { if (!cancelled) setIptrs([]); });
    return () => { cancelled = true; };
  }, [students]);

  const sections = useMemo(
    () => [...new Set(students.map((s) => s.section).filter(Boolean))].sort(),
    [students],
  );

  // Build the preview whenever the filters or the data change.
  //
  // ⚠ MERGES with what is already on screen rather than replacing it. The
  // roster and the "who already has next year" lookup arrive in two separate
  // requests, so this effect runs twice — and a plain rebuild wiped every
  // per-student choice made in between. That is precisely the retain exception
  // this screen exists to capture, silently discarded a second after it was
  // set. Caught by the verification, not by reading the code.
  useEffect(() => {
    const targetByStudent = new Map(
      iptrs.filter((i) => i.school_year === toYear && i.grade_level).map((i) => [i.student_id, i]),
    );
    setRows((prev) => {
      const chosen = new Map(prev.map((r) => [r.student._id, r]));
      return students
        .filter((s) => !section || s.section === section)
        .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''))
        .map((s) => {
          const existingIptr = targetByStudent.get(s._id);
          const existing = chosen.get(s._id);
          // Default is Promote (Retain where there is no grade above). A student who
          // already has a record for the new year is simply updated by whatever is chosen.
          const defaultAction: Action = gradeFor(s.grade_level ?? '', 'promote') ? 'promote' : 'retain';
          return {
            student: s,
            action: existing?.action ?? defaultAction,
            section: existing ? existing.section : (mode === 'transfer' ? '' : (s.section ?? '')),
            alreadyHasYear: !!existingIptr,
            existingIptr,
          };
        });
    });
    setResult(null);
  }, [students, iptrs, section, toYear]);

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.student._id === id ? { ...r, ...patch } : r)));

  const graduating = grade === GRADES[GRADES.length - 1];
  const target = nextGrade(grade);

  // --- Tick-and-apply selection -------------------------------------------
  // Layered ON TOP of the per-row dropdowns, never replacing them: tick a set,
  // apply one action to all of it, then adjust exceptions row by row. The
  // dropdowns stay the source of truth, so ignoring the tickboxes entirely
  // leaves the original flow untouched.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSection, setBulkSection] = useState('');
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  // Narrowing by grade + section alone stops being enough once a section is a
  // real class list; the Base44 prototype's equivalent screen has a name/ID
  // search and ours did not. Purely a VIEW filter -- it never changes which
  // students the run touches, only which ones are on screen.
  const [search, setSearch] = useState('');
  // Promote mode only: show everyone, only students not yet in the new year, or only
  // those already moved. A VIEW filter like the search -- it never changes who a run touches.
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'moved'>('all');

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byStatus = mode === 'promote' && statusFilter !== 'all'
      ? rows.filter((r) => (statusFilter === 'moved' ? r.alreadyHasYear : !r.alreadyHasYear))
      : rows;
    if (!q) return byStatus;
    return byStatus.filter((r) => {
      const st: any = r.student;
      return [surnameFirst(st), st.last_name, st.first_name, st.middle_name, st.section, st.grade_level]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [rows, search, mode, statusFilter]);
  const visibleIds = useMemo(() => new Set(visibleRows.map((r) => r.student._id)), [visibleRows]);

  // Drop ids no longer on screen (grade/section changed). A selection the
  // operator cannot see would make the next bulk action touch students they are
  // not looking at.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const onScreen = new Set(rows.map((r) => r.student._id));
      const next = new Set([...prev].filter((id) => onScreen.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // "All" means all VISIBLE. With a search active, a header tick that silently
  // selected filtered-out students would be the same trap the selection-pruning
  // effect above exists to avoid.
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.student._id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) for (const r of visibleRows) next.delete(r.student._id);
      else for (const r of visibleRows) next.add(r.student._id);
      return next;
    });
  /** Selected but filtered out of view — the bulk bar must not act on these. */
  const hiddenSelected = [...selected].filter((id) => !visibleIds.has(id)).length;

  // Which actions a row can legally take. A student who already has a toYear
  // record can only be corrected or skipped -- promoting them would POST a
  // duplicate and 409 on uniqueBy (Sprint 102). The bulk bar must respect this
  // or it would appear to act on rows it silently cannot change.
  const canTake = (r: RowState, a: Action) => !!gradeFor(r.student.grade_level ?? '', a);

  const applyBulkAction = (action: Action) => {
    // selected AND visible. Acting on a student the search has hidden is exactly
    // the "touching rows you are not looking at" hazard this screen guards.
    const picked = visibleRows.filter((r) => selected.has(r.student._id));
    const eligible = new Set(picked.filter((r) => canTake(r, action)).map((r) => r.student._id));
    if (eligible.size === 0) {
      toast.error(`None of the ${picked.length} selected can take that action.`);
      return;
    }
    setRows((prev) => prev.map((r) => (eligible.has(r.student._id) ? { ...r, action } : r)));
    // Say what was NOT changed. A bulk action that quietly skips rows is the
    // same class of lie as a filter that changes a label but not the data.
    const skipped = picked.length - eligible.size;
    toast.success(
      `Applied to ${eligible.size} student${eligible.size === 1 ? '' : 's'}` +
      (skipped > 0 ? ` — ${skipped} left unchanged (no grade ${action === 'skipgrade' ? 'two above' : 'above'} them).` : '.'),
    );
  };

  const applyBulkSection = () => {
    const value = bulkSection.trim();
    if (!value) return;
    const picked = visibleRows.filter((r) => selected.has(r.student._id));
    if (picked.length === 0) {
      toast.error('Tick the students first.');
      return;
    }
    const ids = new Set(picked.map((r) => r.student._id));
    setRows((prev) => prev.map((r) => (ids.has(r.student._id) ? { ...r, section: value } : r)));
    toast.success(`Section set to "${value}" for ${picked.length} student${picked.length === 1 ? '' : 's'}.`);
  };
  // Promote is driven by the per-row ACTION; transfer is driven by the
  // SELECTION. Keeping them on different inputs means neither can silently
  // inherit the other's intent when the mode is switched.
  const transferPicked = rows.filter((r) => selected.has(r.student._id));
  const toApply = rows.filter((r) => !!gradeFor(r.student.grade_level ?? '', r.action));
  const toCreate = toApply.filter((r) => !r.alreadyHasYear);
  const toCorrect = toApply.filter((r) => r.alreadyHasYear);

  const runTransfer = async () => {
    setRunning(true);
    setError(null);
    let moved = 0;
    let studentOnly = 0;
    const failed: string[] = [];
    for (const r of transferPicked) {
      const newGrade = transferGrade || r.student.grade_level || '';
      const newSection = r.section || null;
      try {
        // The CURRENT year's record, not next year's. A transfer corrects where
        // the student already is; creating a year record here would silently
        // promote them, which is the other tab's job.
        const current = iptrs.find(
          (i) => i.student_id === r.student._id && i.school_year === fromYear,
        );
        if (current) {
          await apiClient.put(`/student-iptrs/${current._id}`, {
            grade_level: newGrade,
            section: newSection,
          });
          moved += 1;
        } else {
          // No record for this year yet. Deliberately does NOT create one --
          // that is Promote's job and would put the student in a year they have
          // not been examined in. The enrolment still moves, and the summary
          // reports these separately so it is visible rather than silent.
          studentOnly += 1;
        }
        await apiClient.put(`/students/${r.student._id}`, {
          grade_level: newGrade,
          section: r.section,
        });
      } catch (err) {
        failed.push(`${surnameFirst(r.student)} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setResult({ created: moved, corrected: studentOnly, skipped: rows.length - transferPicked.length, failed });
    setRunning(false);
    if (moved > 0) toast.success(`${moved} student${moved === 1 ? '' : 's'} moved within ${fromYear}.`);
    if (studentOnly > 0) toast.success(`${studentOnly} had no ${fromYear} record — enrolment updated only.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be moved — see the summary.`);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    let created = 0;
    let corrected = 0;
    const failed: string[] = [];
    for (const r of toApply) {
      // Retained students repeat the grade; promoted ones move up. Graduating
      // students have no next grade, so only "retain" is meaningful there.
      // `update` keeps the student in whatever grade the existing record says —
      // it is a correction of THIS year's placement, not a second promotion.
      // Re-deriving it from `target` would quietly bump anyone corrected twice.
      const newGrade = gradeFor(r.student.grade_level ?? '', r.action) ?? (r.student.grade_level ?? '');
      try {
        if (r.existingIptr) {
          // Sprint 102: correct the year record in place. POSTing again would
          // 409 on uniqueBy (student_id + school_year) — which is exactly why
          // this screen used to be unable to fix its own mistakes.
          await apiClient.put(`/student-iptrs/${r.existingIptr._id}`, {
            grade_level: newGrade,
            section: r.section || null,
          });
          corrected += 1;
        } else {
          // Starting the year leaves an EMPTY record for every student (so the dental
          // chart lists the year). Fill that one in; POSTing would 409 on it.
          const empty = iptrs.find((i) => i.student_id === r.student._id && i.school_year === toYear && !i.grade_level);
          if (empty) {
            await apiClient.put(`/student-iptrs/${empty._id}`, { grade_level: newGrade, section: r.section || null });
          } else {
            await apiClient.post('/student-iptrs', {
              student_id: r.student._id,
              school_year: toYear,
              grade_level: newGrade,
              section: r.section || null,
            });
          }
          created += 1;
        }
        // Current enrolment follows — that is what promotion MEANS, and it is
        // what the rosters and the appointment picker read.
        await apiClient.put(`/students/${r.student._id}`, { grade_level: newGrade, section: r.section });
      } catch (err) {
        failed.push(`${surnameFirst(r.student)} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setResult({ created, corrected, skipped: rows.length - toApply.length, failed });
    setRunning(false);
    if (created > 0) toast.success(`${created} student${created === 1 ? '' : 's'} moved into ${toYear}.`);
    if (corrected > 0) toast.success(`${corrected} ${toYear} record${corrected === 1 ? '' : 's'} corrected.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be moved — see the summary.`);
  };

  // ── Archive selected students ────────────────────────────────────────────────
  // The same soft archive Bulk Assignment offers (PATCH .../archive; a System
  // Admin can restore from Archived Records). Lives here so a student who has left
  // can be removed from the very list being promoted.
  const [showArchive, setShowArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const runArchive = async () => {
    setArchiving(true);
    let archived = 0;
    const failed: string[] = [];
    const done = new Set<string>();
    for (const id of selected) {
      const r = rows.find((x) => x.student._id === id);
      try {
        await apiClient.patch(`/students/${id}/archive`);
        archived += 1;
        done.add(id);
      } catch (err) {
        failed.push(`${r ? surnameFirst(r.student) : id} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setStudents((prev) => prev.filter((st) => !done.has(st._id)));
    setSelected(new Set());
    setArchiving(false);
    setShowArchive(false);
    if (archived > 0) toast.success(`${archived} student${archived === 1 ? ' is' : 's are'} archived.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be archived: ${failed[0]}`);
  };

  const field = 'border border-slate-400 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring';
  const label = 'mb-1 block text-sm font-semibold text-foreground';
  const movedCount = rows.filter((r) => r.alreadyHasYear).length;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* Progress for the list on screen (promotion only). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {mode === 'promote' && rows.length > 0 && (
          <div className="w-full sm:w-60">
            <div className="mb-1 flex justify-between text-xs">
              <b className="truncate text-foreground">{grade}{section ? ` · ${section}` : ''}</b>
              <span className="text-muted-foreground">{movedCount} of {rows.length} moved</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-green-600 transition-all" style={{ width: `${rows.length ? (movedCount / rows.length) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div className="space-y-5 rounded-xl border-2 border-slate-300 bg-white p-4 shadow-sm">
          <div>
            <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-white">1</span><span className="text-base font-bold text-foreground">Which students?</span></div>
            <div className="space-y-3">
              <label className={label} htmlFor="pa-grade">Grade <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 align-[1px] text-[11px] font-bold text-green-800">Current</span></label>
              <select id="pa-grade" value={grade} onChange={(e) => { setGrade(e.target.value); setSection(''); setSelected(new Set()); }} className={`w-full ${field}`} aria-label="Grade">
                <option value="">Choose a grade…</option>
                {mode === 'transfer' && <option value={UNASSIGNED}>No grade or section yet</option>}
                {GRADES.map((g) => <option key={g}>{g}</option>)}
              </select>
              <label className={`${label} !mt-3`} htmlFor="pa-section">Section <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 align-[1px] text-[11px] font-bold text-green-800">Current</span></label>
              <select id="pa-section" value={section} onChange={(e) => setSection(e.target.value)} className={`w-full ${field}`} aria-label="Section" disabled={!grade || grade === UNASSIGNED}>
                <option value="">Every section</option>
                {sections.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-white">2</span><span className="text-base font-bold text-foreground">{mode === 'promote' ? 'Where will they go?' : 'Where should they move?'}</span></div>
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
                <div className="text-[11px] font-semibold text-muted-foreground">Now</div>
                <div className="text-sm font-bold text-foreground">{grade ? (grade === UNASSIGNED ? 'No grade or section yet' : `${grade}${section ? ` · ${section}` : ''}`) : <span className="font-normal text-muted-foreground">Pick a grade in step 1</span>}</div>
              </div>
              <div className="text-center text-3xl font-bold leading-none text-muted-foreground" aria-hidden="true">↓</div>
              <div className={`space-y-3 rounded-lg border-2 p-3 ${mode === 'promote' ? 'border-red-400 bg-red-50' : 'border-green-500 bg-green-50'}`}>
                <div className="flex items-center gap-2 text-sm font-bold">
                  {mode === 'promote'
                    ? <><span className="text-red-700">Promotion</span><span className="rounded-full bg-red-200 px-2 py-px text-[10px] font-semibold text-red-800">{toYear}</span></>
                    : <><span className="text-green-700">Will update to</span><span className="rounded-full bg-green-200 px-2 py-px text-[10px] font-semibold text-green-800">{fromYear}</span></>}
                </div>
                <div>
                  <label className={label} htmlFor="pa-to">Grade</label>
                  {mode === 'promote' ? (
                    <div id="pa-to" className="rounded-lg border border-slate-400 bg-slate-50 px-3 py-2.5 text-sm font-medium text-primary"><span className="flex items-center justify-between gap-2"><span>{grade ? (target ?? `Stays in ${grade}`) : ''}</span><span className="text-xs font-normal text-muted-foreground">Automatic</span></span></div>
                  ) : (
                    <select id="pa-to" value={transferGrade} onChange={(e) => setTransferGrade(e.target.value)} className={`w-full ${field} font-medium text-primary`} aria-label="Move to grade">
                      <option value="">{grade === UNASSIGNED ? 'Choose a grade…' : 'Stay in their current grade'}</option>
                      {GRADES.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="pa-bulk-section">Section</label>
                  <div className="flex gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="pa-bulk-section"
                        type="text"
                        value={bulkSection}
                        onChange={(e) => { setBulkSection(e.target.value); setSectionMenuOpen(true); }}
                        onFocus={() => setSectionMenuOpen(true)}
                        onBlur={() => setSectionMenuOpen(false)}
                        placeholder="Search or add a section"
                        autoComplete="off"
                        className={`w-full ${field}`}
                      />
                      {sectionMenuOpen && (
                        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                          {sections.filter((x) => x.toLowerCase().startsWith(bulkSection.trim().toLowerCase())).map((x) => (
                            <button key={x} type="button" onMouseDown={() => { setBulkSection(x); setSectionMenuOpen(false); }} className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-gray-50">{x}</button>
                          ))}
                          {bulkSection.trim() && !sections.some((x) => x.toLowerCase() === bulkSection.trim().toLowerCase()) && (
                            <button type="button" onMouseDown={() => setSectionMenuOpen(false)} className="block w-full border-t border-border px-3 py-2 text-left text-sm text-primary hover:bg-primary/5">+ Add "{bulkSection.trim()}" as new section</button>
                          )}
                          {sections.length === 0 && !bulkSection.trim() && <p className="px-3 py-2 text-xs text-muted-foreground">Type to add a section</p>}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={applyBulkSection} disabled={!bulkSection.trim() || selected.size === 0} title={selected.size === 0 ? 'Tick the students first' : undefined} className="rounded-lg border border-slate-400 bg-white px-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40">Apply</button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Applies to the selected students. You can also edit each student in the list.</p>
                </div>
              </div>
            </div>
          </div>


          {/* Tick-and-apply. Appears only with a selection, so the screen is
              unchanged for anyone who never ticks anything. */}
          {selected.size > 0 && (
            <div className="overflow-hidden rounded-xl border-2 border-primary bg-white">
              <div className="flex items-center justify-between gap-2 bg-primary px-3 py-2 text-sm font-bold text-white">
                <span>{selected.size} student{selected.size === 1 ? '' : 's'} selected</span>
                <button type="button" onClick={() => setSelected(new Set())} className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/30">✕ Clear</button>
              </div>
              <div className="space-y-2 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{mode === 'promote' ? 'Pick an action below, or use the Action column.' : 'Confirm below to update.'}</div>
              {hiddenSelected > 0 && (
                <div className="text-xs text-amber-700">{hiddenSelected} hidden by the search or filter. Actions apply to the {selected.size - hiddenSelected} shown.</div>
              )}
              {mode === 'promote' && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => applyBulkAction('promote')} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-gray-50">Promote</button>
                  <button type="button" onClick={() => applyBulkAction('retain')} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-gray-50">Retain</button>
                  <button type="button" onClick={() => applyBulkAction('skipgrade')} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-gray-50">Skip a grade</button>
                </div>
              )}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t-2 border-slate-200 pt-4">
            <div className="mb-1 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-white">3</span><span className="text-base font-bold text-foreground">Tick the students, then confirm</span></div>
            <button
              onClick={mode === 'transfer' ? runTransfer : run}
              disabled={running || (mode === 'transfer' ? transferPicked.length === 0 || (grade === UNASSIGNED && !transferGrade) : toApply.length === 0)}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {running ? 'Working…'
                : mode === 'transfer'
                  ? `Move ${transferPicked.length} selected student${transferPicked.length === 1 ? '' : 's'}`
                  : `Update ${toApply.length} student${toApply.length === 1 ? '' : 's'} for ${toYear}`}
            </button>
            <button onClick={onClose} disabled={running} className="w-full rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-gray-50 disabled:opacity-50">
              {result ? 'Close' : 'Cancel'}
            </button>
            {rows.length > 0 && mode === 'promote' && (
              <p className="text-xs text-muted-foreground">
                <b className="text-foreground">{toCreate.length}</b> of {rows.length} will get a new {toYear} record
                {toCorrect.length > 0 && <>, and <b className="text-amber-700">{toCorrect.length}</b> existing {toYear} record{toCorrect.length === 1 ? '' : 's'} will be OVERWRITTEN</>}.
              </p>
            )}
            {rows.length > 0 && mode === 'transfer' && (
              <p className="text-xs text-muted-foreground">
                <b className="text-foreground">{transferPicked.length}</b> of {rows.length} selected will move to <b className="text-foreground">{transferGrade || 'their current grade'}</b>. This updates their {fromYear} record. <b className="text-foreground">No new school year is started.</b>
              </p>
            )}
          </div>

          <div className="space-y-1 border-t border-border pt-3 text-sm">
            {mode === 'transfer' && unassignedCount > 0 && (
              <button type="button" onClick={() => { setGrade(UNASSIGNED); setSection(''); setSelected(new Set()); }} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left font-semibold text-primary hover:bg-primary/5">
                <ListChecks className="h-4 w-4" /> Students without a grade
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{unassignedCount}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowArchive(true)}
              disabled={selected.size === 0 || running || archiving}
              title={selected.size === 0 ? 'Select the students to archive first' : undefined}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left font-semibold text-destructive hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ArchiveIcon className="h-4 w-4" /> Archive selected students
            </button>
          </div>
        </div>

        {/* ── Students ───────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-3">
          {graduating && (
            <Notice variant="warning">
              {grade} is the exit year — there is no grade above it. Students here can be retained, but not promoted.
              Leaving school is not recorded by this system.
            </Notice>
          )}
          {error && <Notice variant="error">{error}</Notice>}

          {!grade && (
            <div className="grid min-h-64 place-items-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
              <div>
                <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">No students to show yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Start with step 1: choose a grade, and the students will appear here.</p>
              </div>
            </div>
          )}

          {loading && <p className="text-sm text-muted-foreground">Loading roster…</p>}

          {!loading && grade && rows.length === 0 && (
            <Notice variant="warning">No students in {grade}{section ? ` · ${section}` : ''} at this school.</Notice>
          )}

          {rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border-2 border-slate-300 bg-white shadow-sm">
              {/* Count, status filter and search. VIEW filters only -- they never
                  change which students the run touches, which is why the counts
                  on the left still read from every row. */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <span className="text-[14.5px] font-normal text-foreground">{rows.length} student{rows.length === 1 ? '' : 's'}</span>
                <span className="text-[12.5px] text-muted-foreground">· {selected.size} selected</span>
                {mode === 'promote' && (
                  <div className="flex gap-1.5 sm:ml-2">
                    {([['all', 'All'], ['todo', `Not yet moved · ${rows.length - movedCount}`], ['moved', `Moved · ${movedCount}`]] as const).map(([k, t]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setStatusFilter(k)}
                        aria-pressed={statusFilter === k}
                        className={`rounded-full px-3 py-1 text-[12.5px] font-normal ${statusFilter === k ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-muted-foreground hover:bg-gray-200'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative w-full sm:ml-auto sm:w-60">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search a student"
                    aria-label="Search the roster by name or section"
                    className="w-full rounded-lg border border-border bg-card py-1.5 pl-9 pr-8 text-[14.5px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear the search" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {visibleRows.length === 0 && (
                <p className="px-4 py-6 text-[14.5px] text-muted-foreground">
                  No student matches{search ? <> “{search}”</> : ' this filter'}. The {rows.length} in this list are still counted — the search and filter only change what is shown.
                </p>
              )}

              {/* overflow-x-auto: wide tables scroll inside their own container,
                  never the page (CLAUDE.md, phone width). */}
              {visibleRows.length > 0 && (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="w-full border-collapse text-[14.5px]">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="w-9 px-3 py-2">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={allSelected ? 'Deselect all students' : 'Select all students'} className="h-4 w-4 cursor-pointer align-middle accent-primary" />
                        </th>
                        <th className="whitespace-nowrap px-3 py-2 text-left text-[14.5px] font-bold text-foreground">Student</th>
                        <th className="whitespace-nowrap px-3 py-2 text-left text-[14.5px] font-bold text-foreground">Current</th>
                        {mode === 'transfer' && <th className="whitespace-nowrap px-3 py-2 text-left text-[14.5px] font-bold text-green-700">Will update to <span className="ml-1 rounded-full bg-green-200 px-2 py-px text-[10px] font-semibold text-green-800">{fromYear}</span></th>}
                        {mode === 'promote' && <th className="whitespace-nowrap px-3 py-2 text-left text-[14.5px] font-bold text-red-700">Promote to <span className="ml-1 rounded-full bg-red-200 px-2 py-px text-[10px] font-semibold text-red-800">{toYear}</span></th>}
                        {mode === 'promote' && <th className="px-3 py-2 text-left text-[14.5px] font-bold text-foreground">Action</th>}
                        <th className="whitespace-nowrap px-3 py-2 text-left text-[14.5px] font-bold text-foreground" title={`Section in ${mode === 'promote' ? toYear : fromYear}`}>Section</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleRows.map((r) => (
                        <tr
                          key={r.student._id}
                          className={mode === 'transfer' && !selected.has(r.student._id) ? 'opacity-60' : ''}
                        >
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selected.has(r.student._id)} onChange={() => toggleOne(r.student._id)} aria-label={`Select ${surnameFirst(r.student)}`} className="h-4 w-4 cursor-pointer align-middle accent-primary" />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-normal text-foreground">{surnameFirst(r.student)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[12.5px] text-muted-foreground">
                            <span className="rounded-md bg-green-100 px-2 py-0.5 font-normal text-green-800">{r.student.grade_level || 'no grade'}{r.student.section ? ` · ${r.student.section}` : ''}</span>
                          </td>
                          {mode === 'transfer' && (
                            <td className="whitespace-nowrap px-3 py-2 text-[12.5px]">
                              {selected.has(r.student._id)
                                ? <span className="rounded-full border border-primary px-2.5 py-0.5 font-normal text-primary">{transferGrade || r.student.grade_level || 'no grade'}{r.section ? ` · ${r.section}` : ''}</span>
                                : <span className="text-muted-foreground">Not selected</span>}
                            </td>
                          )}
                          {mode === 'promote' && (
                            <td className="whitespace-nowrap px-3 py-2">
                              {(() => {
                                const g = gradeFor(r.student.grade_level ?? '', r.action);
                                return g
                                  ? <span className="inline-flex rounded-full border border-red-400 bg-red-50 px-2.5 py-0.5 text-[12.5px] font-normal text-red-700">{g}{r.section ? ` · ${r.section}` : ''}</span>
                                  : <span className="text-[12.5px] text-muted-foreground">No grade above</span>;
                              })()}
                            </td>
                          )}
                          {mode === 'promote' && (
                            <td className="px-3 py-2">
                              <select
                                value={r.action}
                                onChange={(e) => {
                                  const action = e.target.value as Action;
                                  // Retain copies the previous section too.
                                  setRow(r.student._id, action === 'retain' ? { action, section: r.student.section ?? '' } : { action });
                                }}
                                className="rounded-md border border-border bg-card px-2 py-1 text-[12.5px]"
                                aria-label={`Action for ${surnameFirst(r.student)}`}
                              >
                                {(['promote', 'retain', 'skipgrade'] as const).map((a) => (
                                  <option key={a} value={a} disabled={!canTake(r, a)}>
                                    {ACTION_LABEL[a]}{gradeFor(r.student.grade_level ?? '', a) ? ` → ${gradeFor(r.student.grade_level ?? '', a)}` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <SectionCombo
                              value={r.section}
                              onChange={(v) => setRow(r.student._id, { section: v })}
                              options={sections}
                              disabled={mode === 'promote' ? false : !selected.has(r.student._id)}
                              ariaLabel={`Section for ${surnameFirst(r.student)}`}
                              className="w-28 rounded-md border border-border px-2 py-1 text-[12.5px] disabled:opacity-50"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {result && (
            <Notice variant={result.failed.length ? 'error' : 'success'}>
              {mode === 'transfer'
                ? <>{result.created} moved within {fromYear}{result.corrected > 0 && `, ${result.corrected} had no ${fromYear} record so only enrolment changed`}, {result.skipped} not ticked.</>
                : <>{result.created + result.corrected} updated for {toYear}{result.skipped > 0 && `, ${result.skipped} could not be placed (no grade above)`}.</>}
              {result.failed.length > 0 && (
                <ul className="mt-1 list-inside list-disc">{result.failed.map((f) => <li key={f}>{f}</li>)}</ul>
              )}
            </Notice>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showArchive}
        title={`Archive ${selected.size} student${selected.size === 1 ? '' : 's'}?`}
        message="Archived students are removed from active rosters and reports. A System Admin can restore them later from Archived Records."
        confirmLabel="Archive"
        tone="danger"
        busy={archiving}
        onConfirm={runArchive}
        onCancel={() => setShowArchive(false)}
      />
    </div>
  );
};
