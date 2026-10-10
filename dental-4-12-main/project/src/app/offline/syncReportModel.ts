// What the sync report shows, built from the history rows one sync (or the last
// seven days) wrote. Pure: no IndexedDB, no React, so the grouping rules are tested.
//
// One ROW per field of a record. A field edited more than once while offline has
// several VERSIONS (Original, Edit 1, ..., Latest); the latest was synced
// automatically and a person may pick another to keep.
import { formatValue, humanizeField } from './describeWrite';

export type EntryStatus = 'synced' | 'conflict' | 'failed' | 'auth';

export interface HistoryFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** One queued write, as it was recorded when the sync handled it. */
export interface WriteEntry {
  kind: 'write';
  id: number;
  runId: string;
  /** When the sync handled it. */
  at: number;
  /** When it was saved on the device, offline. */
  queuedAt: number;
  status: EntryStatus;
  reason?: string;
  op: 'create' | 'update' | 'archive';
  resource: string;
  recordId?: string;
  studentId?: string;
  studentName?: string;
  studentSub?: string;
  module: string;
  /** "Tooth record updated" */
  label: string;
  /** "Tooth #55" or "Student record" */
  subject: string;
  fields: HistoryFieldChange[];
}

/** Someone picked a version to keep (or went back to the original). */
export interface RestoreEntry {
  kind: 'restore';
  id: number;
  runId: string;
  at: number;
  resource: string;
  recordId: string;
  field: string;
  /** The version key picked: 'orig' or the id of the write whose value was kept. */
  picked: string;
  value: unknown;
}

export type HistoryEntry = WriteEntry | RestoreEntry;

export interface Version {
  /** 'orig' or the write entry's id as a string. */
  key: string;
  label: 'Original' | 'Latest' | string;
  value: string;
  raw: unknown;
  /** When it was saved on the device (undefined for the original). */
  at?: number;
}

export interface ReportRow {
  key: string;
  field: string;
  subject: string;
  module: string;
  op: WriteEntry['op'];
  status: EntryStatus;
  reason?: string;
  resource: string;
  recordId?: string;
  fieldName?: string;
  before: string;
  /** The version currently in force (the latest edit, unless a person picked another). */
  current: Version;
  versions: Version[];
  /** Time shown in the "saved offline" column. */
  savedAt: number;
  /** For a created or archived record: the fields the write carried (the report draws them,
   *  since the one summary line cannot say which teeth or which boxes). */
  detail?: HistoryFieldChange[];
  /** True when a version other than the latest is in force. */
  picked: boolean;
  /** Can a version be chosen (an update that synced). */
  canPick: boolean;
}

export type StudentStatus = 'none' | 'synced' | 'attention' | 'restored' | 'partial';

export interface ReportStudent {
  studentId: string;
  name: string;
  sub?: string;
  rows: ReportRow[];
  status: StudentStatus;
}

function studentStatus(rows: ReportRow[]): StudentStatus {
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.status !== 'synced')) return 'attention';
  const pickable = rows.filter((r) => r.canPick);
  const back = pickable.filter((r) => r.current.key === 'orig').length;
  if (pickable.length > 0 && back === pickable.length && pickable.length === rows.length) return 'restored';
  if (back > 0) return 'partial';
  return 'synced';
}

/** Groups history by student. `others` are students that had nothing to sync
 *  (they are listed too, as "No changes"). */
export function buildReport(entries: HistoryEntry[], others: { studentId: string; name: string; sub?: string }[] = []): ReportStudent[] {
  const writes = entries.filter((e): e is WriteEntry => e.kind === 'write').sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id);
  const restores = entries.filter((e): e is RestoreEntry => e.kind === 'restore').sort((a, b) => a.at - b.at || a.id - b.id);

  const byStudent = new Map<string, { name: string; sub?: string; writes: WriteEntry[] }>();
  for (const w of writes) {
    // Changes whose student could not be worked out stay together as ONE entry, not one
    // "student" per record (a cleared mouth is thirty of them).
    const id = w.studentId ?? 'unknown';
    let s = byStudent.get(id);
    if (!s) byStudent.set(id, (s = { name: w.studentName ?? 'Unknown student', sub: w.studentSub, writes: [] }));
    if (w.studentName && s.name === 'Unknown student') s.name = w.studentName;
    s.writes.push(w);
  }

  const out: ReportStudent[] = [];
  for (const [studentId, s] of byStudent) {
    const rows: ReportRow[] = [];
    const fieldRows = new Map<string, WriteEntry[]>();
    for (const w of s.writes) {
      if (w.op !== 'update' || w.status !== 'synced') continue;
      for (const f of w.fields) {
        const key = `${w.resource}|${w.recordId}|${f.field}`;
        const list = fieldRows.get(key) ?? [];
        list.push(w);
        fieldRows.set(key, list);
      }
    }
    const emitted = new Set<string>();
    for (const w of s.writes) {
      if (w.op === 'update' && w.status === 'synced') {
        for (const f of w.fields) {
          const key = `${w.resource}|${w.recordId}|${f.field}`;
          if (emitted.has(key)) continue;
          emitted.add(key);
          const edits = fieldRows.get(key)!;
          const chain = edits.map((e) => ({ e, f: e.fields.find((x) => x.field === f.field)! }));
          const first = chain[0];
          const versions: Version[] = [
            { key: 'orig', label: 'Original', value: formatValue(first.f.before), raw: first.f.before },
            ...chain.map((c, i) => ({
              key: String(c.e.id),
              label: i === chain.length - 1 ? 'Latest' : `Edit ${i + 1}`,
              value: formatValue(c.f.after),
              raw: c.f.after,
              at: c.e.queuedAt,
            })),
          ];
          const pick = restores.filter((r) => r.resource === w.resource && r.recordId === w.recordId && r.field === f.field).pop();
          const current = (pick && versions.find((v) => v.key === pick.picked)) || versions[versions.length - 1];
          rows.push({
            key,
            field: humanizeField(f.field),
            subject: w.subject,
            module: w.module,
            op: 'update',
            status: 'synced',
            resource: w.resource,
            recordId: w.recordId,
            fieldName: f.field,
            before: versions[0].value,
            current,
            versions,
            savedAt: current.at ?? chain[chain.length - 1].e.queuedAt,
            picked: current.key !== versions[versions.length - 1].key,
            // Restoring needs the original value; a record never cached has none.
            canPick: first.f.before !== undefined,
          });
        }
      } else {
        if (w.op === 'update') {
          // An edit that did not sync: one row per field, shown as not applied.
          for (const f of w.fields.length ? w.fields : [{ field: '', before: undefined, after: undefined }]) {
            const v: Version = { key: String(w.id), label: 'Latest', value: formatValue(f.after), raw: f.after, at: w.queuedAt };
            rows.push({
              key: `${w.id}|${f.field}`, field: f.field ? humanizeField(f.field) : w.label, subject: w.subject, module: w.module, op: w.op,
              status: w.status, reason: w.reason, resource: w.resource, recordId: w.recordId, fieldName: f.field || undefined,
              before: formatValue(f.before), current: v, versions: [v], savedAt: w.queuedAt, picked: false, canPick: false,
            });
          }
        } else {
          // A created or archived record is ONE row (a new student or a tooth is not
          // ten rows), summarised, and cannot be restored here.
          const shown = w.fields.slice(0, 4).map((f) => `${humanizeField(f.field)} ${formatValue(f.after)}`);
          const more = w.fields.length - shown.length;
          const summary = w.op === 'archive' ? 'Archived' : shown.join(', ') + (more > 0 ? ` +${more} more` : '');
          const v: Version = { key: String(w.id), label: 'Latest', value: summary || w.label, raw: undefined, at: w.queuedAt };
          rows.push({
            key: String(w.id), field: w.label, subject: w.subject, module: w.module, op: w.op, status: w.status, reason: w.reason,
            resource: w.resource, recordId: w.recordId, before: w.op === 'create' ? '(none)' : '(active)', current: v, versions: [v],
            savedAt: w.queuedAt, picked: false, canPick: false, detail: w.fields,
          });
        }
      }
    }
    out.push({ studentId, name: s.name, sub: s.sub, rows, status: studentStatus(rows) });
  }
  for (const o of others) {
    if (!out.some((s) => s.studentId === o.studentId)) out.push({ studentId: o.studentId, name: o.name, sub: o.sub, rows: [], status: 'none' });
  }
  // Needs-attention first, then alphabetical.
  return out.sort((a, b) => (a.status === 'attention' ? 0 : 1) - (b.status === 'attention' ? 0 : 1) || a.name.localeCompare(b.name));
}
