// What one queue drain did, handed to the "back online" dialog. Same pattern as
// queueEvents.ts: IndexedDB has no same-tab change notifications, so a tiny bus.
export interface SyncReportItem {
  module: string;
  kind: string;
  /** Specifics worth showing when a kind appears once (a name, a tooth number). */
  detail?: string;
  status: 'synced' | 'failed' | 'conflict' | 'auth';
  /** Why it did not sync (failed / conflict / auth only). */
  reason?: string;
}

export interface SyncReport {
  /** Ties this drain to its rows in the sync history (syncHistory.ts). */
  runId: string;
  items: SyncReportItem[];
  finishedAt: number;
}

type Listener = (report: SyncReport) => void;
const listeners = new Set<Listener>();

export function subscribeSyncReport(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySyncReport(report: SyncReport): void {
  for (const listener of listeners) listener(report);
}

export interface ReportLine {
  kind: string;
  status: SyncReportItem['status'];
  count: number;
  /** Specifics, one per change (names, tooth numbers). */
  details: string[];
  /** Distinct reasons it did not sync. */
  reasons: string[];
}

export interface ReportGroup {
  module: string;
  lines: ReportLine[];
}

/** Collapses a drain into "Dental chart: Tooth record added ×12" lines, in the
 *  order things first happened, so a 30-row chart save reads as one line. */
export function groupSyncReport(items: SyncReportItem[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  for (const item of items) {
    let group = groups.get(item.module);
    if (!group) groups.set(item.module, (group = { module: item.module, lines: [] }));
    let line = group.lines.find((l) => l.kind === item.kind && l.status === item.status);
    if (!line) group.lines.push((line = { kind: item.kind, status: item.status, count: 0, details: [], reasons: [] }));
    line.count += 1;
    if (item.detail) line.details.push(item.detail);
    if (item.reason && !line.reasons.includes(item.reason)) line.reasons.push(item.reason);
  }
  return [...groups.values()];
}

// Asks the sync report to open on demand (the account menu): the last seven days,
// not only the latest sync.
const requestListeners = new Set<() => void>();
export function subscribeReportRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}
export function requestSyncReport(): void {
  for (const listener of requestListeners) listener();
}
