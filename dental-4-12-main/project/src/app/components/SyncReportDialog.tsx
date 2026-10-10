import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { Modal } from './Modal';
import { subscribeSyncReport, subscribeReportRequest } from '../offline/syncReport';
import { requestConflictReview, isConflictReviewOpen } from '../offline/queueEvents';
import { loadReport, type LoadedReport, type ReportScope } from '../offline/syncHistory';
import { pickVersion } from '../offline/restore';
import type { ReportRow, ReportStudent, StudentStatus, Version } from '../offline/syncReportModel';
import { buildDateGroups } from '../offline/syncReportVisual';
import { StudentDay } from './SyncReportDay';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// The sync report. Changes made offline sync by themselves when the connection
// returns; this is the review of what happened. EVERY student and EVERY change is
// on one page (nobody has to open a student to see what changed), students with
// nothing to sync are listed too, and anything that went wrong can be put back:
// a field edited more than once offline shows each version, the latest is already
// synced, and any other version (or the original) can be kept instead. Kept
// versions are sent as ordinary new edits, so the server audits them.
// History is held on this device for 7 days (offline/syncHistory.ts).

type Filter = 'all' | 'synced' | 'attention' | 'restored';

const time = (t?: number) => (t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const dateTime = (t?: number) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const PILL: Record<StudentStatus, { label: string; cls: string }> = {
  synced: { label: 'Synced', cls: 'bg-green-100 text-green-800' },
  none: { label: 'No changes', cls: 'bg-muted text-muted-foreground' },
  attention: { label: 'Needs attention', cls: 'bg-red-100 text-red-800' },
  restored: { label: 'Restored', cls: 'bg-violet-100 text-violet-800' },
  partial: { label: 'Partly restored', cls: 'bg-amber-100 text-amber-800' },
};

const initials = (name: string) => name.replace(',', '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const SyncReportDialog = () => {
  const { isOnline } = useOfflineQueue();
  const [scope, setScope] = useState<ReportScope | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [data, setData] = useState<LoadedReport | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [module, setModule] = useState('all');
  const [confirm, setConfirm] = useState<{ kind: 'item'; id: string } | { kind: 'date'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => subscribeSyncReport((report) => {
      setLastRun(report.runId);
      // While the conflict review is open, a change that synced is already shown
      // by its card disappearing; only something that did NOT sync may interrupt.
      if (isConflictReviewOpen() && report.items.every((i) => i.status === 'synced')) return;
      // A second drain finishing while the report is open joins it, so nothing
      // the person has not read yet is lost.
      setScope((prev) => (prev?.kind === 'run' ? { kind: 'run', runIds: [...prev.runIds, report.runId] } : { kind: 'run', runIds: [report.runId] }));
    }),
    [],
  );
  useEffect(() => subscribeReportRequest(() => setScope(lastRun ? { kind: 'run', runIds: [lastRun] } : { kind: 'week' })), [lastRun]);

  const reload = useCallback(async () => {
    if (scope) setData(await loadReport(scope));
  }, [scope]);
  useEffect(() => {
    setData(null);
    setFilter('all');
    setQuery('');
    setModule('all');
    setConfirm(null);
    setMessage(null);
    if (scope) void reload();
  }, [scope, reload]);

  // Only students who had changes are listed (user, 2026-10-11).
  const students = useMemo(() => (data?.students ?? []).filter((s) => s.status !== 'none'), [data]);
  const counts = useMemo(() => {
    const c = { all: students.length, synced: 0, attention: 0, restored: 0 };
    for (const s of students) {
      if (s.status === 'attention') c.attention++;
      else if (s.status === 'restored') c.restored++;
      else c.synced++;
    }
    return c;
  }, [students]);
  const modules = useMemo(() => [...new Set(students.flatMap((s) => s.rows.map((r) => r.module)))].sort(), [students]);

  const visible = students.filter((s) => {
    if (filter === 'synced' && !(s.status === 'synced' || s.status === 'partial')) return false;
    if (filter === 'attention' && s.status !== 'attention') return false;
    if (filter === 'restored' && !(s.status === 'restored' || s.status === 'partial')) return false;
    if (query && !`${s.name} ${s.sub ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (module !== 'all' && !s.rows.some((r) => r.module === module)) return false;
    return true;
  });

  const dateGroups = useMemo(() => buildDateGroups(visible), [visible]);

  if (!scope) return null;
  const close = () => setScope(null);

  const run = async (work: () => Promise<number>) => {
    setBusy(true);
    setMessage(null);
    try {
      const n = await work();
      setMessage(n === 0 ? 'Nothing to restore.' : `Done. ${n} change${n === 1 ? '' : 's'} sent as new edits.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That could not be saved. Nothing was changed.');
    } finally {
      setBusy(false);
      setConfirm(null);
      await reload();
    }
  };

  const pick = (row: ReportRow, version: Version) => run(async () => { await pickVersion(row, version); return 1; });
  const restoreRows = (rows: ReportRow[]) =>
    run(async () => {
      let n = 0;
      for (const r of rows) {
        if (r.canPick && r.current.key !== 'orig') { await pickVersion(r, r.versions[0]); n++; }
      }
      return n;
    });
  const needsConnection = !isOnline;

  return (
    <Modal onClose={close} maxWidth="max-w-5xl">
      <div className="px-5 pt-5 pb-3 flex flex-wrap items-start gap-3">
        {counts.attention === 0 ? <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" aria-hidden="true" /> : <AlertTriangle className="h-6 w-6 flex-shrink-0 text-amber-600" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">Sync History</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {scope.kind === 'run'
              ? data?.firstSavedAt ? `Saved offline from ${dateTime(data.firstSavedAt)}. Synced automatically at ${time(data.syncedAt)}.` : 'Loading.'
              : 'Everything synced from this device in the last 7 days.'}
          </p>
        </div>
        <button type="button" onClick={() => setScope(scope.kind === 'run' ? { kind: 'week' } : lastRun ? { kind: 'run', runIds: [lastRun] } : scope)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted">
          {scope.kind === 'run' ? 'Show last 7 days' : lastRun ? 'Show latest sync' : 'Last 7 days'}
        </button>
      </div>

      <div className="sticky top-0 z-10 bg-card border-y border-border px-5 py-3 flex flex-wrap items-center gap-2">
        {([['all', 'With changes', counts.all], ['synced', 'Synced', counts.synced], ['attention', 'Needs attention', counts.attention], ['restored', 'Restored', counts.restored]] as const).map(([key, label, n]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${filter === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}>
            {label} <span className={key === 'attention' && filter !== key && n > 0 ? 'text-red-700' : ''}>{n}</span>
          </button>
        ))}
        <label className="relative flex-1 min-w-[10rem] max-w-xs">
          <span className="sr-only">Search students</span>
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student, grade, section" className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-2 text-sm" />
        </label>
        <select aria-label="Filter by type of change" value={module} onChange={(e) => setModule(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm">
          <option value="all">All types</option>
          {modules.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>

      {message && <p role="status" className="mx-5 mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{message}</p>}
      {needsConnection && <p className="mx-5 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">You are offline. Restoring needs a connection.</p>}

      <div className="px-5 py-4 flex flex-col gap-3">
        {data === null && <p className="py-8 text-center text-sm text-muted-foreground">Loading the report.</p>}
        {data !== null && visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{students.length === 0 ? 'Nothing was synced from this device yet.' : 'No students match these filters.'}</p>}
        {dateGroups.map((g) => {
          const dateRows = g.items.flatMap((i) => i.day.rows);
          const restorableCount = dateRows.filter((r) => r.canPick && r.current.key !== 'orig').length;
          const changes = dateRows.length;
          return (
            <section key={g.key}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-border pb-1.5">
                <h3 className="text-base font-bold text-foreground">{g.label}</h3>
                <span className="text-xs text-muted-foreground">{g.long} · {g.items.length} student{g.items.length === 1 ? '' : 's'} · {changes} change{changes === 1 ? '' : 's'}</span>
                <span className="flex-1" />
                {restorableCount > 0 && (
                  <button type="button" disabled={busy || needsConnection} onClick={() => setConfirm({ kind: 'date', id: g.key })} className="rounded-lg border border-border bg-card px-3 py-1 text-sm font-semibold hover:bg-muted disabled:opacity-50">
                    Restore this day
                  </button>
                )}
              </div>
              {confirm?.kind === 'date' && confirm.id === g.key && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="min-w-[12rem] flex-1"><b>Restore {restorableCount} change{restorableCount === 1 ? '' : 's'} from {g.label} to their original values?</b> Each one is sent as a new edit and recorded in the audit trail.</span>
                  <button type="button" disabled={busy} onClick={() => void restoreRows(dateRows)} className="rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50">Restore</button>
                  <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Cancel</button>
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {g.items.map(({ student, day }) => {
                  const itemKey = `${student.studentId}|${day.key}`;
                  return (
                    <StudentDay key={itemKey} student={student} day={day} busy={busy || needsConnection}
                      canRestore={day.rows.filter((r) => r.canPick && r.current.key !== 'orig').length}
                      confirming={confirm?.kind === 'item' && confirm.id === itemKey}
                      onAskRestore={() => setConfirm({ kind: 'item', id: itemKey })}
                      onCancelRestore={() => setConfirm(null)}
                      onRestore={() => void restoreRows(day.rows)}
                      onPick={pick}
                      onReview={() => { close(); requestConflictReview(); }} />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
        <div className="flex flex-1 flex-wrap gap-2 min-w-[12rem] text-xs font-semibold text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{counts.synced} synced</span>
          <span className={`rounded-md bg-muted px-2 py-1 ${counts.attention ? 'text-red-700' : ''}`}>{counts.attention} need attention</span>
          <span className="rounded-md bg-muted px-2 py-1">{counts.restored} restored</span>
        </div>
        {counts.attention > 0 && (
          <button type="button" onClick={() => { close(); requestConflictReview(); }} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">Review changes that need a decision</button>
        )}
        <button type="button" onClick={close} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Close</button>
      </div>
    </Modal>
  );
};
