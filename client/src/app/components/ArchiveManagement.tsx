import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Archive as ArchiveIcon } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { ApiStudent, ApiSchool, ApiStudentIptr, ApiAppointment, ApiTreatment } from '../api/types';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { formatDate, formatDateTime } from '../utils/localDate';
import { surnameFirst } from '../utils/studentName';

// ─── Archived records (System Admin) ─────────────────────────────────────────
// CLAUDE.md lists "restore archived records" as a System Admin capability and
// the API has supported it since Sprint 6 — `?includeArchived=true` (admin
// only) and `PATCH /:id/restore`. There was no interface for either, so an
// archived record was invisible from inside the app and recoverable only by a
// direct database query. This is that interface.
//
// ⚠ `includeArchived=true` returns ARCHIVED AND ACTIVE records — the server
// drops the isArchived filter entirely rather than inverting it — so the list
// is narrowed here. Reading that flag as "archived only" would show every
// record in the system with a Restore button beside it.

type Row = Record<string, any>;

interface Kind {
  key: string;
  label: string;
  path: string;
  /** Human identity for one archived row. */
  describe: (r: Row, ctx: Ctx) => string;
  /** Extra context column, where one helps. */
  detail?: (r: Row, ctx: Ctx) => string;
}

interface Ctx {
  studentById: Map<string, ApiStudent>;
  schoolById: Map<string, ApiSchool>;
}

const KINDS: Kind[] = [
  {
    key: 'student-iptrs',
    label: 'School years (IPTR)',
    path: '/student-iptrs',
    describe: (r: ApiStudentIptr, c) => {
      const s = c.studentById.get(r.student_id);
      return s ? surnameFirst(s) : 'Unknown student';
    },
    detail: (r: ApiStudentIptr) => `SY ${r.school_year}${r.grade_level ? ` · ${r.grade_level} ${r.section ?? ''}`.trimEnd() : ''}`,
  },
  {
    key: 'students',
    label: 'Students',
    path: '/students',
    describe: (r: ApiStudent) => surnameFirst(r),
    detail: (r: ApiStudent, c) =>
      [c.schoolById.get(r.school_id)?.school_name, r.grade_level, r.section].filter(Boolean).join(' · '),
  },
  {
    key: 'schools',
    label: 'Schools',
    path: '/schools',
    describe: (r: ApiSchool) => r.school_name,
    detail: (r: ApiSchool) => [r.school_type, r.barangay, r.city].filter(Boolean).join(', '),
  },
  {
    key: 'appointments',
    label: 'Appointments',
    path: '/appointments',
    describe: (r: ApiAppointment, c) => {
      const s = c.studentById.get(r.student_id);
      return s ? surnameFirst(s) : 'Unknown student';
    },
    detail: (r: ApiAppointment) => `${formatDate(r.appointment_datetime)} · ${r.appointment_type} · ${r.status}`,
  },
  {
    key: 'treatments',
    label: 'Treatments',
    path: '/treatments',
    describe: (r: ApiTreatment) => r.diagnosis || 'Treatment record',
    detail: (r: ApiTreatment) => [formatDate(r.date), r.treatment_done].filter(Boolean).join(' · '),
  },
];

export const ArchiveManagement = () => {
  const toast = useToast();
  const [kindKey, setKindKey] = useState(KINDS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [ctx, setCtx] = useState<Ctx>({ studentById: new Map(), schoolById: new Map() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);
  const [restoring, setRestoring] = useState(false);

  const kind = KINDS.find((k) => k.key === kindKey) ?? KINDS[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Students and schools resolve the foreign keys the other kinds show.
      // Fetched WITH archived, so an archived student's archived IPTR still
      // renders a name instead of "Unknown student".
      const [all, students, schools] = await Promise.all([
        apiClient.get<Row[]>(`${kind.path}?includeArchived=true`),
        apiClient.get<ApiStudent[]>('/students?includeArchived=true'),
        apiClient.get<ApiSchool[]>('/schools?includeArchived=true'),
      ]);
      setCtx({
        studentById: new Map(students.map((s) => [s._id, s])),
        schoolById: new Map(schools.map((s) => [s._id, s])),
      });
      setRows(
        all
          .filter((r) => r.isArchived)
          .sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? ''))),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load archived records');
    } finally {
      setLoading(false);
    }
  }, [kind.path]);

  useEffect(() => { void load(); }, [load]);

  const restore = async () => {
    if (!confirmRow) return;
    setRestoring(true);
    try {
      await apiClient.patch(`${kind.path}/${confirmRow._id}/restore`);
      toast.success(`${kind.describe(confirmRow, ctx)} restored.`);
      setConfirmRow(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to restore');
    } finally {
      setRestoring(false);
    }
  };

  const th = 'px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground';
  const td = 'px-4 py-3 text-sm text-foreground';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Archived Records</h1>
          <p className="text-xs text-muted-foreground">
            Nothing is ever deleted. Archived records are hidden from every other screen and can be restored here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="archive-kind" className="text-sm text-muted-foreground whitespace-nowrap">Record type</label>
          <select
            id="archive-kind"
            aria-label="Record type"
            value={kindKey}
            onChange={(e) => setKindKey(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
      </div>

      {error && <Notice variant="error">{error}</Notice>}

      {loading ? <><SkeletonPageHeader /><SkeletonTable rows={4} /></> : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                <th className={th}>Record</th>
                <th className={th}>Details</th>
                <th className={th}>Archived</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td className={`${td} text-center text-muted-foreground py-10`} colSpan={4}>
                    <ArchiveIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No archived {kind.label.toLowerCase()}.
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r._id} className="hover:bg-gray-50">
                  <td className={`${td} font-medium`}>{kind.describe(r, ctx)}</td>
                  <td className={`${td} text-muted-foreground`}>{kind.detail?.(r, ctx) ?? ''}</td>
                  {/* archivedAt can be null on records archived before the field
                      was populated — say so rather than rendering an empty cell
                      that reads as "not archived". */}
                  <td className={td}>
                    {r.archivedAt ? formatDateTime(r.archivedAt) : <span className="text-muted-foreground">date not recorded</span>}
                  </td>
                  <td className={`${td} text-right`}>
                    <button
                      onClick={() => setConfirmRow(r)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm text-foreground hover:bg-gray-50"
                    >
                      <RotateCcw className="w-4 h-4" /> Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmRow && (
        <ConfirmDialog
          open
          title={`Restore ${kind.describe(confirmRow, ctx)}?`}
          message="It returns to the normal lists and reports immediately, and will be counted again wherever it was counted before."
          confirmLabel={restoring ? 'Restoring…' : 'Restore'}
          onConfirm={restore}
          onCancel={() => setConfirmRow(null)}
        />
      )}
    </div>
  );
};
