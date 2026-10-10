import { useState } from 'react';
import { retryQueue } from '../offline/queueProcessor';
import type { ReportRow, ReportStudent, Version } from '../offline/syncReportModel';
import type { DayView, FlagSource, ToothChange } from '../offline/syncReportVisual';

// The sync history's building blocks: StudentDay (one student on one date, Original and After
// sync side by side) and Row (the full field table behind its Details button).

const time = (t?: number) => (t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

const SOURCE: Record<FlagSource, { dot: string; name: string }> = {
  med: { dot: '#E11D48', name: 'Medical history' },
  diet: { dot: '#EA580C', name: 'Habits' },
  oral: { dot: '#7C3AED', name: 'Oral conditions' },
  svc: { dot: '#D97706', name: 'Services given' },
};

const COND: Record<string, { bg: string; fg: string; word: string }> = {
  D: { bg: '#FCA5A5', fg: '#7F1D1D', word: 'Decayed' },
  M: { bg: '#CBD5E1', fg: '#334155', word: 'Missing' },
  F: { bg: '#93C5FD', fg: '#1E3A8A', word: 'Filled' },
  X: { bg: '#C4B5FD', fg: '#4C1D95', word: 'For extraction' },
  T: { bg: '#99F6E4', fg: '#134E4A', word: 'Treated' },
};
const condOf = (c: string) => COND[c.toUpperCase()] ?? { bg: '#FDE68A', fg: '#78350F', word: c || 'Charted' };

function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={`relative inline-block h-3.5 w-[26px] flex-shrink-0 rounded-full ${on ? 'bg-green-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white ${on ? 'right-0.5' : 'left-0.5'}`} />
    </span>
  );
}

/** Tooth numbers grouped under a condition (user pick 1 of 5, 2026-10-11). */
function TeethGroups({ teeth, side }: { teeth: ToothChange[]; side: 'before' | 'after' }) {
  const groups = new Map<string, number[]>();
  for (const t of teeth) {
    const raw = side === 'before' ? t.before : t.removed ? '_cleared' : t.cond;
    const key = raw === '' ? '_none' : raw === '_cleared' ? '_cleared' : raw.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), t.tooth]);
  }
  const order = ['D', 'F', 'M', 'X', 'T'];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5">
      {keys.map((k) => {
        const none = k === '_none';
        const cleared = k === '_cleared';
        const c = none ? { bg: '#fff', fg: '#64748B', word: 'No record' } : cleared ? { bg: '#fff', fg: '#64748B', word: 'Cleared' } : condOf(k);
        const nums = [...(groups.get(k) ?? [])].sort((a, b) => a - b);
        return (
          <div key={k} className="contents">
            <span className="flex items-center gap-1.5 pt-0.5 text-[12.5px] font-bold">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ background: c.bg, border: `1px ${none || cleared ? 'dashed' : 'solid'} ${c.fg}` }} />{c.word}
            </span>
            <span className="flex flex-wrap gap-1">
              {nums.map((n) => (
                <span key={n} title={`Tooth ${n}: ${c.word}`} style={{ background: c.bg, color: c.fg, borderColor: c.fg }}
                  className={`grid h-[26px] min-w-[28px] place-items-center rounded-[7px] border px-1.5 text-xs font-extrabold ${none || cleared ? 'border-dashed' : ''}`}>{n}</span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SECTION = 'mb-1 text-[11px] font-bold text-muted-foreground';

/** One student's changes on ONE date, as two panels (user pick 2 of 3, 2026-10-11):
 *  Original on the left, After sync on the right, so the eye compares by position.
 *  The full field-by-field table is one click away ("Details"); it is also where a field
 *  edited more than once offline can have an earlier version kept. Anything that did NOT
 *  sync is always shown in full, never reduced to a picture. */
export function StudentDay({
  student, day, busy, canRestore, confirming, onAskRestore, onCancelRestore, onRestore, onPick, onReview,
}: {
  student: ReportStudent;
  day: DayView;
  busy: boolean;
  /** How many of this student's changes that day "Restore" would put back. */
  canRestore: number;
  confirming: boolean;
  onAskRestore: () => void;
  onCancelRestore: () => void;
  onRestore: () => void;
  onPick: (row: ReportRow, version: Version) => void;
  onReview: () => void;
}) {
  const [details, setDetails] = useState(false);
  const n = day.rows.length;
  const hasPicture = day.teeth.length + day.flags.length + day.measures.length + day.texts.length > 0;
  const flagGroups = (['med', 'diet', 'oral', 'svc'] as const)
    .map((s) => ({ s, items: day.flags.filter((f) => f.source === s) }))
    .filter((g) => g.items.length > 0);
  const initials = student.name.replace(',', '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const flagList = (side: 'before' | 'after') => flagGroups.map(({ s, items }) => (
    <div key={s} className="mb-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">{SOURCE[s].name}</div>
      {items.map((f) => {
        const on = side === 'before' ? f.from : f.to;
        return (
          <div key={f.label} className="flex items-center gap-2 py-0.5 text-[12.5px]">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SOURCE[s].dot }} />
            <span className={`min-w-0 flex-1 truncate ${side === 'after' ? 'rounded bg-yellow-100 px-1' : ''}`} title={f.label}>{f.label}{side === 'after' && f.edits > 1 ? <span className="ml-1 text-[10px] text-muted-foreground">edited {f.edits}x</span> : null}</span>
            <Switch on={on} />
            <b className={`w-7 ${side === 'after' ? 'text-blue-800' : 'text-slate-500'}`}>{on ? 'Yes' : 'No'}</b>
          </div>
        );
      })}
    </div>
  ));

  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-primary" aria-hidden="true">{initials}</span>
        <div className="min-w-0">
          <div className="font-bold text-foreground">{student.name}</div>
          <div className="text-xs text-muted-foreground">{[student.sub, `${n} change${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
        </div>
        <span className="flex-1" />
        <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted">
          {details ? 'Hide details' : 'Details'}
        </button>
        {canRestore > 0 && (
          <button type="button" disabled={busy} onClick={onAskRestore} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            Restore
          </button>
        )}
      </div>

      {confirming && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="min-w-[12rem] flex-1"><b>Restore {canRestore} change{canRestore === 1 ? '' : 's'} for {student.name} on {day.label} to their original values?</b> Each one is sent as a new edit and recorded in the audit trail.</span>
          <button type="button" disabled={busy} onClick={onRestore} className="rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50">Restore</button>
          <button type="button" onClick={onCancelRestore} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Cancel</button>
        </div>
      )}

      {day.problems.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {day.problems.map((r) => <Row key={r.key} row={r} busy={busy} onPick={onPick} onReview={onReview} />)}
        </div>
      )}

      {hasPicture && (
        <div className="flex flex-wrap items-stretch gap-2.5">
          <div className="min-w-[14rem] flex-1 rounded-xl bg-[#F1F3F7] px-3 py-2.5">
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">Original</div>
            {day.teeth.length > 0 && <div className="mb-2"><div className={SECTION}>Teeth charted</div><TeethGroups teeth={day.teeth} side="before" /></div>}
            {day.flags.length > 0 && <div className="mb-2"><div className={SECTION}>Findings and services</div>{flagList('before')}</div>}
            {day.measures.length > 0 && (
              <div className="mb-2"><div className={SECTION}>Measurements</div>
                {day.measures.map((m) => <div key={m.label} className="flex justify-between gap-2 py-0.5 text-[12.5px]"><span>{m.label}</span><b className="text-slate-600">{m.from ?? 'none'} <span className="font-normal">{m.unit}</span></b></div>)}
              </div>
            )}
            {day.texts.length > 0 && (
              <div><div className={SECTION}>Other</div>
                {day.texts.map((t, i) => <div key={`${t.label}-${i}`} className="flex justify-between gap-2 py-0.5 text-[12.5px]"><span>{t.label}</span><b className="text-right text-slate-600">{t.from || 'none'}</b></div>)}
              </div>
            )}
          </div>
          <div className="grid place-items-center text-lg text-muted-foreground max-sm:hidden" aria-hidden="true">→</div>
          <div className="min-w-[14rem] flex-1 rounded-xl bg-[#EAF2FF] px-3 py-2.5">
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-blue-800">After sync</div>
            {day.teeth.length > 0 && <div className="mb-2"><div className={SECTION}>Teeth charted <b className="text-foreground">{day.teeth.length}</b></div><TeethGroups teeth={day.teeth} side="after" /></div>}
            {day.flags.length > 0 && <div className="mb-2"><div className={SECTION}>Findings and services</div>{flagList('after')}</div>}
            {day.measures.length > 0 && (
              <div className="mb-2"><div className={SECTION}>Measurements</div>
                {day.measures.map((m) => {
                  const max = Math.max(m.from ?? 0, m.to ?? 0) * 1.1 || 1;
                  return (
                    <div key={m.label} className="py-0.5 text-[12.5px]">
                      <div className="flex justify-between gap-2"><span>{m.label}</span><b className="rounded bg-yellow-100 px-1 text-blue-800">{m.to ?? 'none'} <span className="font-normal">{m.unit}</span></b></div>
                      <div className="relative mt-1 h-1.5 rounded-full bg-slate-200" aria-hidden="true">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-slate-400" style={{ width: `${((m.from ?? 0) / max) * 100}%` }} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-teal-600/75" style={{ width: `${((m.to ?? 0) / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {day.texts.length > 0 && (
              <div><div className={SECTION}>Other</div>
                {day.texts.map((t, i) => <div key={`${t.label}-${i}`} className="flex justify-between gap-2 py-0.5 text-[12.5px]"><span>{t.label}</span><b className="rounded bg-yellow-100 px-1 text-right text-blue-800">{t.to}</b></div>)}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-1.5 text-xs text-muted-foreground">Saved offline {time(day.from)}{day.to - day.from > 60_000 ? ` to ${time(day.to)}` : ''}</div>

      {details && (
        <div role="table" aria-label={`All changes for ${student.name} on ${day.label}`} className="mt-3 rounded-lg border border-border">
          <div role="row" className="hidden md:grid grid-cols-[minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(8rem,1.1fr)_5.5rem_8rem] gap-3 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Field</span><span>Original</span><span>After sync</span><span>Saved offline</span><span />
          </div>
          {day.rows.map((r) => <Row key={r.key} row={r} busy={busy} onPick={onPick} onReview={onReview} />)}
        </div>
      )}
    </div>
  );
}

export const Row = ({ row, busy, onPick, onReview }: { row: ReportRow; busy: boolean; onPick: (row: ReportRow, version: Version) => void; onReview: () => void }) => {
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
