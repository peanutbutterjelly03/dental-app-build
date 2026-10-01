import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Archive as ArchiveIcon, Filter, Search, Calendar } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { apiClient, ApiError } from '../api/client';
import type { ApiUser, ApiStudent, ApiSchool } from '../api/types';
import { SkeletonTable } from './Skeleton';
import { Modal } from './Modal';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { formatDateTime } from '../utils/localDate';
import { surnameFirst } from '../utils/studentName';
import { ROLE_LABELS } from '../hooks/useUsers';
import { schoolGradeLabel } from '../utils/schoolGrades';

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
  /** Singular module name shown as the pill ("Student"). */
  module: string;
  pill: { bg: string; fg: string; border: string };
  path: string;
  /** Human identity for one archived row. */
  describe: (r: Row, ctx: Ctx) => string;
  /** Extra context column, where one helps. */
  detail?: (r: Row, ctx: Ctx) => string;
  /** Labelled facts shown in the restore pop-up. */
  facts: (r: Row, ctx: Ctx) => [string, string][];
}

interface Ctx {
  studentById: Map<string, ApiStudent>;
  schoolById: Map<string, ApiSchool>;
  userById: Map<string, ApiUser>;
}

const KINDS: Kind[] = [
  {
    key: 'students',
    label: 'Students',
    module: 'Student',
    pill: { bg: '#F4F7FF', fg: '#273A78', border: '#DCE3F5' },
    path: '/students',
    describe: (r: ApiStudent) => surnameFirst(r),
    detail: (r: ApiStudent, c) =>
      [c.schoolById.get(r.school_id)?.school_name, r.grade_level, r.section].filter(Boolean).join(' · '),
    facts: (r: ApiStudent, c) => [
      ['School', c.schoolById.get(r.school_id)?.school_name ?? ''],
      ['Grade and section', [r.grade_level, r.section].filter(Boolean).join(' · ')],
    ],
  },
  {
    key: 'schools',
    label: 'Schools',
    module: 'School',
    pill: { bg: '#ECFEFF', fg: '#0E7490', border: '#A5F3FC' },
    path: '/schools',
    describe: (r: ApiSchool) => r.school_name,
    detail: (r: ApiSchool) => [schoolGradeLabel(r), r.barangay, r.city].filter(Boolean).join(', '),
    facts: (r: ApiSchool) => [
      ['Grades', schoolGradeLabel(r)],
      ['Location', [r.barangay, r.city].filter(Boolean).join(', ')],
    ],
  },
];

const FIELD = 'w-full px-4 py-3 text-sm text-[#475569] bg-[#F8FAFC] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#16214F]/30';
const FIELD_STYLE = { border: '1px solid #E2E8F0' } as const;
const CARD = 'bg-card rounded-2xl border border-border shadow-[0_4px_20px_rgba(0,0,0,0.06)]';
const TH = 'px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider';

const ModulePill = ({ kind }: { kind: Kind }) => (
  <span
    className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold"
    style={{ backgroundColor: kind.pill.bg, color: kind.pill.fg, borderColor: kind.pill.border }}
  >
    {kind.module}
  </span>
);

export const ArchiveManagement = () => {
  const toast = useToast();
  const [kindKey, setKindKey] = useState(KINDS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [ctx, setCtx] = useState<Ctx>({ studentById: new Map(), schoolById: new Map(), userById: new Map() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState('');

  const kind = KINDS.find((k) => k.key === kindKey) ?? KINDS[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Students and schools resolve the foreign keys the other kinds show.
      // Fetched WITH archived, so an archived student's archived IPTR still
      // renders a name instead of "Unknown student".
      const [all, students, schools, users] = await Promise.all([
        apiClient.get<Row[]>(`${kind.path}?includeArchived=true`),
        apiClient.get<ApiStudent[]>('/students?includeArchived=true'),
        apiClient.get<ApiSchool[]>('/schools?includeArchived=true'),
        // Whoever archived a record may have been deactivated since.
        apiClient.get<ApiUser[]>('/users?includeArchived=true').catch(() => [] as ApiUser[]),
      ]);
      setCtx({
        studentById: new Map(students.map((s) => [s._id, s])),
        schoolById: new Map(schools.map((s) => [s._id, s])),
        userById: new Map(users.map((u) => [u._id, u])),
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

  const archiver = (r: Row) => {
    const u = r.archivedBy ? ctx.userById.get(String(r.archivedBy)) : undefined;
    return u ? { name: u.full_name, role: ROLE_LABELS[u.role] ?? u.role } : null;
  };

  // Search narrows the loaded list only; it never refetches.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${archiver(r)?.name ?? ''} ${kind.module} ${kind.describe(r, ctx)}`.toLowerCase().includes(q));
  }, [rows, search, kind, ctx]);

  // archivedAt / archivedBy can be null on records archived before those fields
  // were populated: say so rather than render an empty cell that reads as
  // "not archived".
  const notRecorded = <span className="text-muted-foreground">Not recorded</span>;
  const archivedDate = (r: Row) => r.archivedAt
    ? new Date(r.archivedAt).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
    : null;
  const archivedTime = (r: Row) => r.archivedAt
    ? new Date(r.archivedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const ArchivedBy = ({ r }: { r: Row }) => {
    const u = archiver(r);
    if (!u) return r.archivedBy ? <span className="text-muted-foreground">Unknown user</span> : notRecorded;
    return (
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] text-sm font-bold">{u.name.trim().charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-foreground">{u.name}</div>
          <div className="text-xs text-muted-foreground">{u.role}</div>
        </div>
      </div>
    );
  };

  const RestoreBtn = ({ r }: { r: Row }) => (
    <button
      onClick={() => setConfirmRow(r)}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-surface text-primary text-sm font-bold hover:opacity-80 transition-opacity"
    >
      <RotateCcw className="w-4 h-4" /> Restore
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ArchiveIcon}
        eyebrow="System Administration"
        title="Archived Records"
        description="Nothing is ever deleted. Archived records are hidden from every other screen and can be restored here."
      />

      {error && <Notice variant="error">{error}</Notice>}

      <div className={CARD}>
        <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F1F5F9] text-[#334155] flex-shrink-0"><Filter className="w-5 h-5" /></span>
          <div>
            <div className="text-base font-bold text-foreground">Search &amp; Filters</div>
            <div className="text-sm text-muted-foreground">Choose a record type and refine the list.</div>
          </div>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search by archived by, module, or record"
              aria-label="Search archived records"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${FIELD} pl-12`}
              style={FIELD_STYLE}
            />
          </div>
          <select
            id="archive-kind"
            aria-label="Record type"
            value={kindKey}
            onChange={(e) => { setKindKey(e.target.value); setSearch(''); }}
            className={FIELD}
            style={FIELD_STYLE}
          >
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? <SkeletonTable rows={4} /> : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 px-6 py-5">
            <div className="flex items-center gap-4">
              <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] flex-shrink-0"><ArchiveIcon className="w-5 h-5" /></span>
              <div>
                <div className="text-xl font-bold text-foreground">Archived {kind.label}</div>
                <div className="text-sm text-muted-foreground">Restore records hidden from the rest of the system.</div>
              </div>
            </div>
            <span className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-bold text-[#64748B] whitespace-nowrap">
              {visible.length} {visible.length === 1 ? 'record' : 'records'} found
            </span>
          </div>

          {visible.length > 0 && (
            <div className="hidden lg:block overflow-x-auto border-t border-border">
              <table className="w-full table-fixed min-w-[1000px]">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className={TH} style={{ width: '22%' }}>Archived by</th>
                    <th className={TH} style={{ width: '13%' }}>Module</th>
                    <th className={TH} style={{ width: '24%' }}>Record</th>
                    <th className={TH} style={{ width: '18%' }}>Date archived</th>
                    <th className={TH} style={{ width: '10%' }}>Time</th>
                    <th className={TH} style={{ width: '13%' }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {visible.map((r) => (
                    <tr key={r._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4"><ArchivedBy r={r} /></td>
                      <td className="px-6 py-4"><ModulePill kind={kind} /></td>
                      <td className="px-6 py-4 text-sm text-foreground">{kind.describe(r, ctx)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {archivedDate(r)
                          ? <span className="inline-flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-[#94A3B8]" />{archivedDate(r)}</span>
                          : notRecorded}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{archivedTime(r) ?? notRecorded}</td>
                      <td className="px-6 py-4"><RestoreBtn r={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {visible.length > 0 && (
            <div className="lg:hidden border-t border-border divide-y divide-gray-200">
              {visible.map((r) => (
                <div key={r._id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-foreground">{kind.describe(r, ctx)}</div>
                    <div className="text-xs text-muted-foreground">{kind.detail?.(r, ctx) ?? ''}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.archivedAt ? formatDateTime(r.archivedAt) : 'Archive date not recorded'}
                      {archiver(r) ? ` · by ${archiver(r)!.name}` : ''}
                    </div>
                  </div>
                  <RestoreBtn r={r} />
                </div>
              ))}
            </div>
          )}

          {visible.length === 0 && (
            <div className="border-t border-border flex flex-col items-center justify-center text-center px-6 py-20">
              <span className="w-[4.5rem] h-[4.5rem] rounded-2xl grid place-items-center bg-[#F1F5F9] text-[#94A3B8]"><ArchiveIcon className="w-8 h-8" /></span>
              <div className="mt-5 text-base font-bold text-foreground">No archived {kind.label.toLowerCase()}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {search ? 'Nothing matches your search.' : 'Nothing of this type has been archived.'}
              </div>
            </div>
          )}
        </div>
      )}

      {confirmRow && (
        <Modal onClose={() => setConfirmRow(null)} maxWidth="max-w-xl" rounded="rounded-2xl" closeDisabled={restoring}>
          <div role="alertdialog" aria-label={`Restore ${kind.describe(confirmRow, ctx)}`} className="overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center gap-4 bg-[#F4F7FF] px-7 py-6 border-b border-border">
              <span className="w-12 h-12 flex-shrink-0 rounded-xl grid place-items-center bg-white text-[#273A78] text-lg font-bold">
                {kind.describe(confirmRow, ctx).trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="text-xl font-bold text-foreground break-words">{kind.describe(confirmRow, ctx)}</div>
                <div className="mt-1.5"><ModulePill kind={kind} /></div>
              </div>
              <div className="ml-auto text-sm text-muted-foreground">Restore this record?</div>
            </div>
            <div className="p-7">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {[
                  ...kind.facts(confirmRow, ctx),
                  ['Archived by', archiver(confirmRow)?.name ?? ''],
                  ['Archived on', confirmRow.archivedAt ? formatDateTime(confirmRow.archivedAt) : ''],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">{label}</dt>
                    <dd className="mt-1 text-sm font-semibold text-foreground break-words">{value || 'Not recorded'}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#475569]">
                It returns to the normal lists and reports right away, and is counted again wherever it was counted before.
              </div>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-border px-7 py-5">
              <button
                onClick={() => setConfirmRow(null)}
                disabled={restoring}
                autoFocus
                className="rounded-xl border border-[#CBD5E1] px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={restore}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#273A78] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                <RotateCcw className="w-4 h-4" /> {restoring ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
