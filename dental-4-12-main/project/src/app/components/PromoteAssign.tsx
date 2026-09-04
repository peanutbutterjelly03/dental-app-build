import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GraduationCap } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { ApiStudent, ApiStudentIptr } from '../api/types';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { schoolYearLabel, nextSchoolYear } from '../utils/schoolYear';
import { surnameFirst } from '../utils/studentName';

// ─── Promote / Assign ────────────────────────────────────────────────────────
// Rollover, in one reviewed action per section instead of one edit per pupil.
//
// Sprint 57a put grade/section on the IPTR, 69 made intake open the year
// record, and 70 made those fields editable one at a time. This is the bulk
// version of that same edit — the piece backlog 23 called "option A" and
// deferred as a rollout feature. At ~8,000 pupils it is the difference between
// roughly thirty actions and eight thousand.
//
// Two records change per pupil, deliberately:
//   • a NEW StudentIptr for the target year, carrying the new grade/section —
//     so next year's record is truthful from the moment it exists, and last
//     year's is left exactly as it was;
//   • the STUDENT's own grade/section, which is CURRENT enrolment and is what
//     rosters and the appointment picker read.
//
// The user's standing constraint applies: no per-record prompts or badges
// across thousands of students. One preview, one confirm, one summary.

export const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];

/** The grade after `g`, or null for the exit year (Grade 10 leaves). */
const nextGrade = (g: string): string | null => {
  const i = GRADES.indexOf(g);
  return i >= 0 && i < GRADES.length - 1 ? GRADES[i + 1] : null;
};

type Action = 'promote' | 'retain' | 'skip';

interface RowState {
  student: ApiStudent;
  action: Action;
  /** Section for the new year — defaults to the one they are in now. */
  section: string;
  /** Already has a record for the target year; nothing to create. */
  alreadyHasYear: boolean;
}

export const PromoteAssign = ({ onClose, schoolId, schoolName, allSections }: {
  onClose: () => void;
  schoolId: string | undefined;
  schoolName: string;
  /** Every section already in use anywhere at this school, for the
   *  per-row Section combobox — school-wide, not just the selected grade,
   *  matching the same scoping fix Add Student's Section field got. */
  allSections: string[];
}) => {
  const toast = useToast();
  const fromYear = schoolYearLabel();
  const toYear = nextSchoolYear(fromYear);

  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [students, setStudents] = useState<ApiStudent[]>([]);
  const [iptrs, setIptrs] = useState<ApiStudentIptr[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: string[] } | null>(null);
  // Which row's Section combobox is showing its suggestion list — one at a
  // time, tracked by student id (same onMouseDown-before-onBlur pattern as
  // Add Student's Section field, see PatientList.tsx).
  const [openSectionRow, setOpenSectionRow] = useState<string | null>(null);

  // The roster for one school + grade, server-filtered (Sprint 56's
  // filterable/filterableText) rather than pulling every student.
  useEffect(() => {
    if (!schoolId || !grade) { setStudents([]); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ school_id: schoolId, grade_level: grade });
    apiClient.get<ApiStudent[]>(`/students?${params}`)
      .then((rows) => { if (!cancelled) setStudents(rows); })
      .catch(() => { if (!cancelled) setStudents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId, grade]);

  // Which of them already have the TARGET year — so a second run cannot
  // double-create. The server would 409 anyway (uniqueBy student_id +
  // school_year), but showing it up front beats reporting failures after.
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
  // per-pupil choice made in between. That is precisely the retain exception
  // this screen exists to capture, silently discarded a second after it was
  // set. Caught by the verification, not by reading the code.
  useEffect(() => {
    const hasTarget = new Set(iptrs.filter((i) => i.school_year === toYear).map((i) => i.student_id));
    setRows((prev) => {
      const chosen = new Map(prev.map((r) => [r.student._id, r]));
      return students
        .filter((s) => !section || s.section === section)
        .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''))
        .map((s) => {
          const already = hasTarget.has(s._id);
          const existing = chosen.get(s._id);
          // A pupil who turns out to already have the year is forced to skip
          // even if a choice was made — the server would refuse it anyway.
          if (already) return { student: s, action: 'skip' as Action, section: existing?.section ?? s.section ?? '', alreadyHasYear: true };
          return existing
            ? { ...existing, student: s, alreadyHasYear: false }
            : { student: s, action: 'promote' as Action, section: s.section ?? '', alreadyHasYear: false };
        });
    });
    setResult(null);
  }, [students, iptrs, section, toYear]);

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.student._id === id ? { ...r, ...patch } : r)));

  const graduating = grade === GRADES[GRADES.length - 1];
  const target = nextGrade(grade);
  const toApply = rows.filter((r) => r.action !== 'skip');

  const run = async () => {
    setRunning(true);
    setError(null);
    let created = 0;
    const failed: string[] = [];
    for (const r of toApply) {
      // Retained pupils repeat the grade; promoted ones move up. Graduating
      // pupils have no next grade, so only "retain" is meaningful there.
      const newGrade = r.action === 'retain' ? (r.student.grade_level ?? '') : (target ?? r.student.grade_level ?? '');
      try {
        await apiClient.post('/student-iptrs', {
          student_id: r.student._id,
          school_year: toYear,
          grade_level: newGrade,
          section: r.section || null,
        });
        // Current enrolment follows — that is what promotion MEANS, and it is
        // what the rosters and the appointment picker read.
        await apiClient.put(`/students/${r.student._id}`, { grade_level: newGrade, section: r.section });
        created += 1;
      } catch (err) {
        failed.push(`${surnameFirst(r.student)} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setResult({ created, skipped: rows.length - toApply.length, failed });
    setRunning(false);
    if (created > 0) toast.success(`${created} pupil${created === 1 ? '' : 's'} moved into ${toYear}.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be moved — see the summary.`);
  };

  const field = 'border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="p-6 space-y-4">
      {/* Actions live top-right, level with the heading — they used to be a
          full-width pair pinned under the roster, which put the primary action
          a scroll away from the controls that decide what it does. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <GraduationCap className="w-5 h-5" /> Assign
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Opens next year's record for a whole section at once.
            <span className="font-medium text-foreground"> {fromYear} </span>
            <ArrowRight className="w-3 h-3 inline mx-0.5" />
            <span className="font-medium text-foreground"> {toYear} </span>
            · {schoolName}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button onClick={onClose} disabled={running}
            className="px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-50">
            {result ? 'Close' : 'Cancel'}
          </button>
          <button onClick={run} disabled={running || toApply.length === 0}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {running ? 'Working…' : `Assign ${toApply.length} Student${toApply.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={grade} onChange={(e) => { setGrade(e.target.value); setSection(''); }} className={field} aria-label="Grade">
          <option value="">Select grade…</option>
          {GRADES.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value)} className={field} aria-label="Section" disabled={!grade}>
          <option value="">All sections</option>
          {sections.map((s) => <option key={s}>{s}</option>)}
        </select>
        {grade && target && (
          <span className="text-xs text-muted-foreground">
            {grade} <ArrowRight className="w-3 h-3 inline" /> <span className="font-medium text-foreground">{target}</span>
          </span>
        )}
      </div>

      {graduating && (
        <Notice variant="warning">
          {grade} is the exit year — there is no grade above it. Pupils here can be retained, but not promoted.
          Leaving school is not recorded by this system.
        </Notice>
      )}

      {error && <Notice variant="error">{error}</Notice>}

      {loading && <p className="text-sm text-muted-foreground">Loading roster…</p>}

      {!loading && grade && rows.length === 0 && (
        <Notice variant="warning">No pupils in {grade}{section ? ` · ${section}` : ''} at this school.</Notice>
      )}

      {rows.length > 0 && (
        <>
          <div className="border border-border rounded-xl overflow-hidden h-96 overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Pupil</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Action</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Section in {toYear}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.student._id} className={r.action === 'skip' ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">
                      {surnameFirst(r.student)}
                      {r.alreadyHasYear && (
                        <span className="block text-[11px] text-muted-foreground">already has a {toYear} record</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.action}
                        onChange={(e) => setRow(r.student._id, { action: e.target.value as Action })}
                        className="text-xs border border-border rounded-md px-2 py-1 bg-card"
                        aria-label={`Action for ${surnameFirst(r.student)}`}
                      >
                        {!graduating && <option value="promote">Assign to {target}</option>}
                        <option value="retain">Retain in {r.student.grade_level}</option>
                        <option value="skip">Skip</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {/* The dropdown wraps in its own `relative` div rather
                          than making the <td> itself relative — some browsers
                          position an absolutely-positioned child of a
                          relatively-positioned TABLE CELL against the table as
                          a whole rather than the cell, which is exactly the
                          "menu floats over the header/other rows" bug this
                          replaced. A plain div is an unambiguous containing
                          block. */}
                      <div className="relative">
                        <input
                          value={r.section}
                          onChange={(e) => setRow(r.student._id, { section: e.target.value })}
                          onFocus={() => setOpenSectionRow(r.student._id)}
                          onBlur={() => setOpenSectionRow(null)}
                          disabled={r.action === 'skip'}
                          autoComplete="off"
                          placeholder="Search or add a section"
                          className="text-xs border border-border rounded-md px-2 py-1 w-36 disabled:opacity-50"
                          aria-label={`Section for ${surnameFirst(r.student)}`}
                        />
                        {openSectionRow === r.student._id && (
                          <div className="absolute z-20 mt-1 w-36 max-h-40 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                            {allSections
                              .filter((s) => !r.section.trim() || s.toLowerCase().startsWith(r.section.trim().toLowerCase()))
                              .map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onMouseDown={() => { setRow(r.student._id, { section: s }); setOpenSectionRow(null); }}
                                  className="block w-full text-left px-2 py-1.5 text-xs text-foreground hover:bg-canvas"
                                >
                                  {s}
                                </button>
                              ))}
                            {r.section.trim() && !allSections.some((s) => s.toLowerCase() === r.section.trim().toLowerCase()) && (
                              <button
                                type="button"
                                onMouseDown={() => setOpenSectionRow(null)}
                                className="block w-full text-left px-2 py-1.5 text-xs text-primary hover:bg-primary-surface border-t border-border"
                              >
                                + Add "{r.section.trim()}" as new section
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{toApply.length}</span> of {rows.length} will get a {toYear} record.
            Each also has their current grade and section updated. Existing years are remained.
          </p>
        </>
      )}

      {result && (
        <Notice variant={result.failed.length ? 'error' : 'success'}>
          {result.created} moved into {toYear}, {result.skipped} skipped.
          {result.failed.length > 0 && (
            <ul className="mt-1 list-disc list-inside">{result.failed.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
        </Notice>
      )}

    </div>
  );
};
