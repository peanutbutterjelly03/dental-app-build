// Records what each sync did, for the sync report and for Restore.
//
// Written when the queue drain handles a change: the student, the fields, the
// value from before (the device's cached server copy) and the value written, and
// when it was saved offline. Kept 7 days on this device, per signed-in user, and
// wiped at sign-out: it holds names and clinical values (SEC-27).
import { addHistoryRows, getHistoryForOwner, purgeHistoryBefore, type QueuedWrite } from './db';
import { loadUserCache } from './authCache';
import { findCachedRecord } from './readCache';
import { describeWrite } from './describeWrite';
import { buildReport, type EntryStatus, type HistoryEntry, type HistoryFieldChange, type ReportStudent, type WriteEntry } from './syncReportModel';
import { getQueuedStudentIds } from '../utils/queueStorage';
import { getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';

export const HISTORY_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Keys never shown as a change: ids and bookkeeping. */
const HIDDEN = /^(_|id$|.*_id$|isArchived|archivedAt|archivedBy|created_at|updated_at)/;

/** The fields a queued write changed, with the value before and after. Pure. */
export function fieldChanges(write: Pick<QueuedWrite, 'method' | 'endpoint' | 'body' | 'originalSnapshot' | 'baselineSnapshot'>): HistoryFieldChange[] {
  const body = isObject(write.body) ? write.body : {};
  const before = write.originalSnapshot ?? write.baselineSnapshot ?? undefined;
  const isCreate = write.method === 'POST';
  const out: HistoryFieldChange[] = [];
  for (const [field, after] of Object.entries(body)) {
    if (HIDDEN.test(field)) continue;
    const was = isCreate ? undefined : before?.[field];
    if (!isCreate && before && sameJson(was, after)) continue; // nothing actually changed
    out.push({ field, before: was, after });
  }
  return out;
}

export function opOf(write: Pick<QueuedWrite, 'method' | 'endpoint'>): WriteEntry['op'] {
  if (write.endpoint.split('?')[0].endsWith('/archive')) return 'archive';
  return write.method === 'POST' ? 'create' : 'update';
}

function recordIdOf(endpoint: string): string | undefined {
  const m = endpoint.split('?')[0].match(/^\/[a-z-]+\/([a-f0-9]{24})(\/|$)/i);
  return m?.[1];
}

/** "Tooth #55", "Student record", ... for the card. */
function subjectOf(write: QueuedWrite): string {
  const d = describeWrite(write);
  const noun = d.kind.replace(/ (added|updated|archived)$/, '');
  const body = isObject(write.body) ? write.body : {};
  const snap = write.originalSnapshot ?? {};
  const tooth = body.tooth_number ?? snap.tooth_number;
  if (tooth !== undefined) return `${noun} #${String(tooth)}`;
  if (d.detail && write.method === 'POST') return `${noun}: ${d.detail}`;
  return noun;
}

interface StudentContext {
  studentId?: string;
  studentName?: string;
  studentSub?: string;
}

/** Which student a change belongs to, found through what this device has cached:
 *  the record itself, its IPTR year, or its chart. */
export async function resolveStudent(
  write: QueuedWrite,
  createdId?: string,
  // Records created earlier in the same sync are not in the read cache yet.
  created: Map<string, Record<string, unknown>> = new Map(),
): Promise<StudentContext> {
  const lookup = async (resource: string, id: string) => created.get(`${resource}|${id}`) ?? (await findCachedRecord(resource, id));
  const resource = write.endpoint.split('?')[0].split('/').filter(Boolean)[0] ?? '';
  const body = isObject(write.body) ? write.body : {};
  const snap = write.originalSnapshot ?? {};
  let studentId: string | undefined;
  if (resource === 'students') studentId = recordIdOf(write.endpoint) ?? createdId;
  studentId ??= str(body.student_id) ?? str(snap.student_id);
  if (!studentId) {
    let iptrId = str(body.iptr_id) ?? str(snap.iptr_id);
    if (!iptrId) {
      const chartId = str(body.chart_id) ?? str(snap.chart_id);
      if (chartId) iptrId = str((await lookup('dental-charts', chartId))?.iptr_id);
    }
    if (iptrId) studentId = str((await lookup('student-iptrs', iptrId))?.student_id);
  }
  if (!studentId) return {};
  const student = (await lookup('students', studentId)) ?? (resource === 'students' ? body : undefined);
  const last = str(student?.last_name);
  const first = str(student?.first_name);
  const grade = str(student?.grade_level);
  const section = str(student?.section);
  return {
    studentId,
    studentName: last || first ? [last, first].filter(Boolean).join(', ') : undefined,
    studentSub: [grade, section].filter(Boolean).join(', ') || undefined,
  };
}

export interface SyncOutcome {
  write: QueuedWrite;
  status: EntryStatus;
  reason?: string;
  /** The server's answer to a create, for the new record's id. */
  data?: { _id?: string } | null;
}

/** Writes one history row per handled change. Never throws: history is a record
 *  of the sync, and a failure to keep it must not undo or block the sync. */
export async function recordSync(runId: string, outcomes: SyncOutcome[]): Promise<void> {
  const owner = loadUserCache()?.id;
  if (!owner || outcomes.length === 0) return;
  try {
    const now = Date.now();
    const rows = [];
    const created = new Map<string, Record<string, unknown>>();
    for (const { write, status, data } of outcomes) {
      if (status === 'synced' && write.method === 'POST' && data?._id && isObject(write.body)) {
        created.set(`${write.endpoint.split('?')[0].split('/').filter(Boolean)[0]}|${data._id}`, write.body);
      }
    }
    for (const { write, status, reason, data } of outcomes) {
      const d = describeWrite(write);
      const op = opOf(write);
      const ctx = await resolveStudent(write, data?._id, created);
      rows.push({
        ownerKey: owner,
        runId,
        at: now,
        kind: 'write' as const,
        queuedAt: write.timestamp,
        status,
        reason,
        op,
        resource: write.endpoint.split('?')[0].split('/').filter(Boolean)[0] ?? 'record',
        recordId: op === 'create' ? data?._id : recordIdOf(write.endpoint),
        module: d.module,
        label: d.kind,
        subject: subjectOf(write),
        fields: op === 'archive' ? [] : fieldChanges(write),
        ...ctx,
      });
    }
    await addHistoryRows(rows);
    await purgeHistoryBefore(owner, now - HISTORY_DAYS * DAY);
  } catch {
    // Storage unavailable or full: the sync itself already happened.
  }
}

/** A restore or "keep this version" is recorded as its own row. */
export async function recordPick(entry: { resource: string; recordId: string; field: string; picked: string; value: unknown }): Promise<void> {
  const owner = loadUserCache()?.id;
  if (!owner) return;
  await addHistoryRows([{ ownerKey: owner, runId: 'pick', at: Date.now(), kind: 'restore', ...entry }]);
}

/** `runIds`: one or more drains that finished close together show as ONE report. */
export type ReportScope = { kind: 'run'; runIds: string[] } | { kind: 'week' };

export interface LoadedReport {
  students: ReportStudent[];
  /** Earliest "saved offline" time and the sync time, for the header. */
  firstSavedAt?: number;
  syncedAt?: number;
  changeCount: number;
}

/** Everything the dialog needs, read from history. For a single sync it also
 *  lists the queued students that had nothing to sync. */
export async function loadReport(scope: ReportScope): Promise<LoadedReport> {
  const owner = loadUserCache()?.id;
  if (!owner) return { students: [], changeCount: 0 };
  await purgeHistoryBefore(owner, Date.now() - HISTORY_DAYS * DAY).catch(() => {});
  const all = (await getHistoryForOwner(owner)) as unknown as HistoryEntry[];
  const inScope = scope.kind === 'run' ? all.filter((e) => (e.kind === 'restore' ? true : scope.runIds.includes(e.runId))) : all;
  // A pick belongs to a field of the rows in scope; keep only those that match one.
  const writes = inScope.filter((e): e is WriteEntry => e.kind === 'write');
  const wanted = new Set(writes.flatMap((w) => w.fields.map((f) => `${w.resource}|${w.recordId}|${f.field}`)));
  const picks = inScope.filter((e) => e.kind === 'restore' && wanted.has(`${e.resource}|${e.recordId}|${e.field}`));

  let others: { studentId: string; name: string; sub?: string }[] = [];
  if (scope.kind === 'run') {
    const seen = new Set(writes.map((w) => w.studentId).filter(Boolean));
    const queued = [...new Set([...getQueuedStudentIds(), ...getTreatmentQueueStudentIds()])].filter((id) => !seen.has(id));
    others = (
      await Promise.all(
        queued.map(async (id) => {
          const s = await findCachedRecord('students', id);
          const last = str(s?.last_name);
          const first = str(s?.first_name);
          if (!s || !(last || first)) return null;
          return { studentId: id, name: [last, first].filter(Boolean).join(', '), sub: [str(s.grade_level), str(s.section)].filter(Boolean).join(', ') || undefined };
        }),
      )
    ).filter((x): x is { studentId: string; name: string; sub: string | undefined } => !!x);
  }
  return {
    students: buildReport([...writes, ...picks], others),
    firstSavedAt: writes.length ? Math.min(...writes.map((w) => w.queuedAt)) : undefined,
    syncedAt: writes.length ? Math.max(...writes.map((w) => w.at)) : undefined,
    changeCount: writes.length,
  };
}
