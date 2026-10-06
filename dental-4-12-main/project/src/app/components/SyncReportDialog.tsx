import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { Modal } from './Modal';
import { subscribeSyncReport, subscribeReportRequest } from '../offline/syncReport';
import { requestConflictReview, isConflictReviewOpen } from '../offline/queueEvents';
import { loadReport, type LoadedReport, type ReportScope } from '../offline/syncHistory';
import { pickVersion } from '../offline/restore';
import { retryQueue } from '../offline/queueProcessor';
import type { ReportRow, ReportStudent, StudentStatus, Version } from '../offline/syncReportModel';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// The sync report. Changes made offline sync by themselves when the connection
// returns; this is the review of what happened. EVERY student and EVERY change is
// on one page (nobody has to open a student to see what changed), students with
// nothing to sync are listed too, and anything that went wrong can be put back:
// a field edited more than once offline shows each version, the latest is already
// synced, and any other version (or the original) can be kept instead. Kept
// versions are sent as ordinary new edits, so the server audits them.
// History is held on this device for 7 days (offline/syncHistory.ts).

type Filter = 'all' | 'synced' | 'none' | 'attention' | 'restored';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: 'student'; id: string } | { kind: 'selected' } | null>(null);
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
    setSelected(new Set());
    setConfirm(null);
    setMessage(null);
    if (scope) void reload();
  }, [scope, reload]);

  const students = data?.students ?? [];
  const counts = useMemo(() => {
    const c = { all: students.length, synced: 0, none: 0, attention: 0, restored: 0 };
    for (const s of students) {
      if (s.status === 'none') c.none++;
      else if (s.status === 'attention') c.attention++;
      else if (s.status === 'restored') c.restored++;
      else c.synced++;
    }
    return c;
  }, [students]);
  const modules = useMemo(() => [...new Set(students.flatMap((s) => s.rows.map((r) => r.module)))].sort(), [students]);

  const visible = students.filter((s) => {
    if (filter === 'synced' && !(s.status === 'synced' || s.status === 'partial')) return false;
    if (filter === 'none' && s.status !== 'none') return false;
    if (filter === 'attention' && s.status !== 'attention') return false;
    if (filter === 'restored' && !(s.status === 'restored' || s.status === 'partial')) return false;
    if (query && !`${s.name} ${s.sub ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (module !== 'all' && !s.rows.some((r) => r.module === module)) return false;
    return true;
  });

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
  const restoreStudents = (list: ReportStudent[]) =>
    run(async () => {
      let n = 0;
      for (const s of list) {
        for (const r of s.rows) {
          if (r.canPick && r.current.key !== 'orig') { await pickVersion(r, r.versions[0]); n++; }
        }
      }
      setSelected(new Set());
      return n;
    });

  const restorable = (s: ReportStudent) => s.rows.filter((r) => r.canPick && r.current.key !== 'orig').length;
  const selectedStudents = students.filter((s) => selected.has(s.studentId));
  const needsConnection = !isOnline;

  return (
    <Modal onClose={close} maxWidth="max-w-5xl">
      <div className="px-5 pt-5 pb-3 flex flex-wrap items-start gap-3">
        {counts.attention === 0 ? <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" aria-hidden="true" /> : <AlertTriangle className="h-6 w-6 flex-shrink-0 text-amber-600" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">Sync report</h2>
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
        {([['all', 'All', counts.all], ['synced', 'Synced', counts.synced], ['none', 'No changes', counts.none], ['attention', 'Needs attention', counts.attention], ['restored', 'Restored', counts.restored]] as const).map(([key, label, n]) => (
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
        {visible.map((s) => (
          <section key={s.studentId} className={`rounded-xl border bg-card overflow-hidden ${s.status === 'attention' ? 'border-red-400' : 'border-border'}`}>
            <div className="flex flex-wrap items-center gap-3 bg-muted/60 border-b border-border px-4 py-2.5">
              {s.status !== 'none' && s.rows.some((r) => r.canPick) ? (
                <input type="checkbox" className="h-4 w-4" aria-label={`Select ${s.name}`} checked={selected.has(s.studentId)} onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(s.studentId); else next.delete(s.studentId); return next; })} />
              ) : <span className="w-4" />}
              <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-card text-xs font-bold text-primary" aria-hidden="true">{initials(s.name)}</span>
              <div className="min-w-0">
                <div className="font-bold text-foreground">{s.name}</div>
                <div className="text-xs text-muted-foreground">{[s.sub, s.rows.length ? `${s.rows.length} change${s.rows.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="flex-1" />
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL[s.status].cls}`}>{PILL[s.status].label}</span>
              {restorable(s) > 0 && (
                <button type="button" disabled={busy || needsConnection} onClick={() => setConfirm({ kind: 'student', id: s.studentId })} className="rounded-lg border border-border bg-card px-3 py-1 text-sm font-semibold hover:bg-muted disabled:opacity-50">
                  Restore all to original
                </button>
              )}
            </div>

            {confirm?.kind === 'student' && confirm.id === s.studentId && (
              <div className="m-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span className="flex-1 min-w-[12rem]"><b>Restore {restorable(s)} change{restorable(s) === 1 ? '' : 's'} for {s.name} to their original values?</b> Each one is sent as a new edit and recorded in the audit trail.</span>
                <button type="button" disabled={busy} onClick={() => restoreStudents([s])} className="rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50">Restore</button>
                <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Cancel</button>
              </div>
            )}

            {s.status === 'none' ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing was changed for this student while offline. No sync needed.</p>
            ) : (
              <div role="table" aria-label={`Changes for ${s.name}`}>
                <div role="row" className="hidden md:grid grid-cols-[minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(8rem,1.1fr)_5.5rem_8rem] gap-3 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <span>Field</span><span>Original</span><span>After sync</span><span>Saved offline</span><span />
                </div>
                {s.rows.map((r) => <Row key={r.key} row={r} busy={busy || needsConnection} onPick={pick} onReview={() => { close(); requestConflictReview(); }} />)}
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
        <div className="flex flex-1 flex-wrap gap-2 min-w-[12rem] text-xs font-semibold text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{counts.synced} synced</span>
          <span className="rounded-md bg-muted px-2 py-1">{counts.none} no changes</span>
          <span className={`rounded-md bg-muted px-2 py-1 ${counts.attention ? 'text-red-700' : ''}`}>{counts.attention} need attention</span>
          <span className="rounded-md bg-muted px-2 py-1">{counts.restored} restored</span>
        </div>
        {selectedStudents.length > 0 && (confirm?.kind === 'selected' ? (
          <>
            <span className="text-sm font-semibold">Restore {selectedStudents.length} student{selectedStudents.length === 1 ? '' : 's'} to original?</span>
            <button type="button" disabled={busy || needsConnection} onClick={() => restoreStudents(selectedStudents)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Restore</button>
            <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">Cancel</button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">{selectedStudents.length} selected</span>
            <button type="button" disabled={busy || needsConnection} onClick={() => setConfirm({ kind: 'selected' })} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50">Restore selected</button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">Clear</button>
          </>
        ))}
        {counts.attention > 0 && (
          <button type="button" onClick={() => { close(); requestConflictReview(); }} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">Review changes that need a decision</button>
        )}
        <button type="button" onClick={close} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Close</button>
      </div>
    </Modal>
  );
};

const Row = ({ row, busy, onPick, onReview }: { row: ReportRow; busy: boolean; onPick: (row: ReportRow, version: Version) => void; onReview: () => void }) => {
  const failed = row.status !== 'synced';
  const edited = row.versions.length > 2;
  const original = row.versions[0];
  const latest = row.versions[row.versions.length - 1];
  return (
    <div role="row" className="grid grid-cols-2 md:grid-cols-[minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(8rem,1.1fr)_5.5rem_8rem] gap-x-3 gap-y-1 border-t border-dashed border-border px-4 py-2 items-start">
      <div role="cell" className="col-span-2 md:col-span-1 font-medium text-foreground">
        {row.field}<span className="block text-xs font-normal text-muted-foreground">{row.subject}</span>
      </div>
      <div role="cell" className="rounded-md bg-muted px-2 py-1 text-sm text-muted-foreground break-words">{row.before}</div>
      <div role="cell" className={`rounded-md px-2 py-1 text-sm font-bold break-words ${failed ? 'bg-red-50 text-red-800' : row.current.key === 'orig' ? 'bg-violet-100 text-violet-800' : 'bg-blue-50 text-blue-800'}`}>
        {failed ? `${row.current.value} (not applied)` : row.current.value}
      </div>
      <div role="cell" className="text-xs text-muted-foreground pt-1">{time(row.savedAt)}</div>
      <div role="cell" className="flex justify-end">
        {row.canPick && !edited && (
          row.current.key === 'orig'
            ? <button type="button" disabled={busy} onClick={() => onPick(row, latest)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50">Undo restore</button>
            : <button type="button" disabled={busy} onClick={() => onPick(row, original)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50" title="Sends the original value as a new, audited edit">Restore</button>
        )}
      </div>

      {failed && (
        <div className="col-span-2 md:col-span-5 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex-1 min-w-[12rem]"><b>{row.status === 'conflict' ? 'Held for your review. ' : 'Not synced. '}</b>{row.reason}</span>
          {row.status === 'conflict'
            ? <button type="button" onClick={onReview} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Review changes</button>
            : <button type="button" onClick={() => void retryQueue()} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Retry</button>}
        </div>
      )}

      {edited && !failed && (
        <div className="col-span-2 md:col-span-5 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground"><b className="text-foreground">Edited {row.versions.length - 1} times offline.</b> The latest value was synced automatically. Pick another version to keep it instead.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.versions.map((v) => {
              const on = v.key === row.current.key;
              return (
                <button key={v.key} type="button" aria-pressed={on} disabled={busy || on} onClick={() => onPick(row, v)}
                  className={`flex min-w-[9rem] max-w-[16rem] flex-1 basis-36 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left disabled:cursor-default ${on ? 'border-2 border-green-600 bg-green-50' : 'border-border bg-card hover:border-primary'}`}>
                  <span className="text-xs font-semibold text-muted-foreground">{v.label}{v.at ? ` · ${time(v.at)}` : ''}</span>
                  <span className="break-words text-sm font-extrabold text-foreground">{v.value}</span>
                  <span className={`text-xs font-bold ${on ? 'text-green-700' : 'text-primary'}`}>{on ? 'Kept' : v.label === 'Latest' ? 'Synced automatically' : 'Keep this'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
