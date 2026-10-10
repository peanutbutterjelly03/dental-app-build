// The sync report, drawn rather than read. Pure (no React, no IndexedDB): turns one
// student's report rows into DAYS, each holding the changes as things a person takes
// in at a glance: teeth that changed, yes/no findings flipping, measurements moving,
// and a short list of anything else. The full table of fields is still one click away
// (the dialog keeps its rows), so nothing is lost by drawing it.
import { humanizeField } from './describeWrite';
import type { ReportRow } from './syncReportModel';

export type FlagSource = 'med' | 'diet' | 'oral' | 'svc';

export interface ToothChange { tooth: number; cond: string; removed: boolean; edits: number }
export interface FlagChange { label: string; from: boolean; to: boolean; source: FlagSource; edits: number }
export interface MeasureChange { label: string; unit: string; from: number | null; to: number | null; edits: number }
export interface TextChange { label: string; from: string; to: string }

export interface DayView {
  /** Local date, YYYY-MM-DD. */
  key: string;
  /** Today, Yesterday, or "Oct 8". */
  label: string;
  /** Earliest and latest time anything was saved that day. */
  from: number;
  to: number;
  rows: ReportRow[];
  teeth: ToothChange[];
  flags: FlagChange[];
  measures: MeasureChange[];
  texts: TextChange[];
  /** Rows that did not sync: always shown in full, never reduced to a picture. */
  problems: ReportRow[];
}

const FLAG_SOURCE: Record<string, FlagSource> = {
  'medical-histories': 'med',
  'dietary-social-habits': 'diet',
  'oral-health-conditions': 'oral',
  'preventive-care-records': 'svc',
};
const MEASURE: Record<string, { label: string; unit: string }> = {
  height_cm: { label: 'Height', unit: 'cm' },
  weight_kg: { label: 'Weight', unit: 'kg' },
  temperature_c: { label: 'Temperature', unit: '°C' },
};
/** Fields that say nothing to a person. */
const QUIET = new Set(['iptr_id', 'chart_id', 'dentist_id', 'student_id', 'visit_number', 'visit_date', 'preventive_id']);

export const localDayKey = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function dayLabel(key: string, now: number = Date.now()): string {
  if (key === localDayKey(now)) return 'Today';
  if (key === localDayKey(now - 86_400_000)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const asNumber = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const toothNumberOf = (row: ReportRow, detail?: Record<string, unknown>): number | null => {
  const fromDetail = asNumber(detail?.tooth_number);
  if (fromDetail !== null) return fromDetail;
  const m = /#?(\d{2})\b/.exec(row.subject);
  return m ? Number(m[1]) : null;
};

export function buildDays(rows: ReportRow[], now: number = Date.now()): DayView[] {
  const byDay = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = localDayKey(r.savedAt);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const days: DayView[] = [];
  for (const [key, list] of byDay) {
    const teeth = new Map<number, ToothChange>();
    const flags: FlagChange[] = [];
    const measures: MeasureChange[] = [];
    const texts: TextChange[] = [];
    const problems: ReportRow[] = [];
    const flag = (label: string, from: boolean, to: boolean, source: FlagSource, edits: number) => {
      if (from !== to) flags.push({ label, from, to, source, edits });
    };

    for (const r of list) {
      if (r.status !== 'synced') { problems.push(r); continue; }
      const edits = Math.max(0, r.versions.length - 1);
      const detail = Object.fromEntries((r.detail ?? []).map((f) => [f.field, f.after]));

      if (r.resource === 'tooth-records') {
        const n = toothNumberOf(r, detail);
        if (n === null) { texts.push({ label: r.field, from: r.before, to: r.current.value }); continue; }
        const prev = teeth.get(n);
        if (r.op === 'archive') teeth.set(n, { tooth: n, cond: prev?.cond ?? '', removed: true, edits: (prev?.edits ?? 0) + 1 });
        else if (r.op === 'create') teeth.set(n, { tooth: n, cond: String(detail.condition ?? ''), removed: false, edits: (prev?.edits ?? 0) + 1 });
        else teeth.set(n, { tooth: n, cond: r.fieldName === 'condition' ? String(r.current.raw ?? '') : (prev?.cond || 'T'), removed: false, edits: (prev?.edits ?? 0) + 1 });
        continue;
      }

      const source = FLAG_SOURCE[r.resource];
      if (source) {
        if (r.op === 'create') {
          for (const f of r.detail ?? []) {
            if (QUIET.has(f.field)) continue;
            if (f.after === true) flag(humanizeField(f.field), false, true, source, 0);
            else if (typeof f.after === 'string' && f.after.trim() !== '' && f.after !== 'Not assessed') texts.push({ label: humanizeField(f.field), from: '', to: f.after });
          }
        } else if (r.op === 'update' && r.fieldName && !QUIET.has(r.fieldName)) {
          const before = r.versions[0].raw;
          const after = r.current.raw;
          if (typeof before === 'boolean' || typeof after === 'boolean' || before === null || after === null) {
            if (typeof after === 'boolean' || typeof before === 'boolean') flag(humanizeField(r.fieldName), before === true, after === true, source, edits);
            else texts.push({ label: humanizeField(r.fieldName), from: r.before, to: r.current.value });
          } else {
            texts.push({ label: humanizeField(r.fieldName), from: r.before, to: r.current.value });
          }
        }
        continue;
      }

      if (r.resource === 'student-iptrs' && r.op === 'update' && r.fieldName && MEASURE[r.fieldName]) {
        const m = MEASURE[r.fieldName];
        measures.push({ label: m.label, unit: m.unit, from: asNumber(r.versions[0].raw), to: asNumber(r.current.raw), edits });
        continue;
      }

      // Anything else: one short line.
      texts.push({
        label: r.op === 'update' ? humanizeField(r.fieldName ?? r.field) : r.field,
        from: r.op === 'update' ? r.before : '',
        to: r.current.value,
      });
    }

    const times = list.map((r) => r.savedAt);
    days.push({
      key,
      label: dayLabel(key, now),
      from: Math.min(...times),
      to: Math.max(...times),
      rows: list,
      teeth: [...teeth.values()].sort((a, b) => a.tooth - b.tooth),
      flags,
      measures,
      texts,
      problems,
    });
  }
  // Newest day first.
  return days.sort((a, b) => (a.key < b.key ? 1 : -1));
}

export const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
