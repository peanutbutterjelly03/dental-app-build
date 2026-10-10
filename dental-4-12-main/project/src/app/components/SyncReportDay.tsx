import { useState } from 'react';
import { retryQueue } from '../offline/queueProcessor';
import type { ReportRow, Version } from '../offline/syncReportModel';
import {
  LOWER_PERMANENT, LOWER_PRIMARY, UPPER_PERMANENT, UPPER_PRIMARY,
  type DayView, type FlagSource, type ToothChange,
} from '../offline/syncReportVisual';

// One student's changes on ONE day, drawn (user pick 4, 2026-10-11): charted teeth as
// coloured squares on a small mouth map, yes/no findings as switches flipping on,
// measurements as before and after bars. The full field-by-field table is one click
// away ("Details"), and it is where a field edited more than once offline can have an
// earlier version kept. Anything that did NOT sync is always shown in full.

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

function TeethMap({ teeth }: { teeth: ToothChange[] }) {
  const changed = new Map(teeth.map((t) => [t.tooth, t]));
  const hasPrimary = teeth.some((t) => UPPER_PRIMARY.includes(t.tooth) || LOWER_PRIMARY.includes(t.tooth));
  const hasPermanent = teeth.some((t) => UPPER_PERMANENT.includes(t.tooth) || LOWER_PERMANENT.includes(t.tooth));
  const cell = (n: number) => {
    const t = changed.get(n);
    const c = t && !t.removed ? condOf(t.cond) : null;
    return (
      <span key={n} title={t ? `Tooth ${n}: ${t.removed ? 'cleared' : condOf(t.cond).word}` : `Tooth ${n}`}
        style={c ? { background: c.bg, color: c.fg, borderColor: c.fg } : undefined}
        className={`grid h-[26px] w-[22px] flex-shrink-0 place-items-center rounded-md border text-[8.5px] font-bold ${t ? (t.removed ? 'border-dashed border-slate-400 bg-white text-slate-500 line-through' : '') : 'border-border bg-muted/40 text-muted-foreground/70'}`}>
        {n}
      </span>
    );
  };
  const row = (nums: number[]) => <div className="flex gap-[3px]">{nums.map(cell)}</div>;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-muted-foreground">Teeth charted <b className="text-foreground">{teeth.length}</b></div>
      <div className="flex flex-col gap-1 overflow-x-auto pb-1">
        {(hasPermanent || !hasPrimary) && <>{row(UPPER_PERMANENT)}{row(LOWER_PERMANENT)}</>}
        {hasPrimary && <>{row(UPPER_PRIMARY)}{row(LOWER_PRIMARY)}</>}
      </div>
    </div>
  );
}

export function DayCard({
  day, busy, canRestore, confirming, onAskRestore, onCancelRestore, onRestore, onPick, onReview,
}: {
  day: DayView;
  busy: boolean;
  /** How many changes "Restore this day" would put back. */
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
  const picture = day.teeth.length + day.flags.length + day.measures.length > 0;
  const bySource = (['med', 'diet', 'oral', 'svc'] as const)
    .map((s) => ({ s, items: day.flags.filter((f) => f.source === s) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="text-sm text-foreground">{day.label}</b>
        <span className="text-xs text-muted-foreground">{time(day.from)}{day.to - day.from > 60_000 ? ` to ${time(day.to)}` : ''} · {n} change{n === 1 ? '' : 's'}</span>
        <span className="flex-1" />
        <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted">
          {details ? 'Hide details' : 'Details'}
        </button>
        {canRestore > 0 && (
          <button type="button" disabled={busy} onClick={onAskRestore} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            Restore this day
          </button>
        )}
      </div>

      {confirming && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="min-w-[12rem] flex-1"><b>Restore {canRestore} change{canRestore === 1 ? '' : 's'} from {day.label} to their original values?</b> Each one is sent as a new edit and recorded in the audit trail.</span>
          <button type="button" disabled={busy} onClick={onRestore} className="rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50">Restore</button>
          <button type="button" onClick={onCancelRestore} className="rounded-lg border border-border bg-card px-3 py-1 font-semibold">Cancel</button>
        </div>
      )}

      {day.problems.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {day.problems.map((r) => <Row key={r.key} row={r} busy={busy} onPick={onPick} onReview={onReview} />)}
        </div>
      )}

      {picture && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          {day.teeth.length > 0 && <div className="min-w-0 flex-[1.4_1_16rem]"><TeethMap teeth={day.teeth} /></div>}
          {day.flags.length > 0 && (
            <div className="min-w-[13rem] flex-1">
              <div className="mb-1 text-xs text-muted-foreground">Findings and services</div>
              {bySource.map(({ s, items }) => (
                <div key={s} className="mb-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">{SOURCE[s].name}</div>
                  {items.map((f) => (
                    <div key={f.label} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SOURCE[s].dot }} />
                      <span className="min-w-0 flex-1 truncate" title={f.label}>{f.label}{f.edits > 1 ? <span className="ml-1 text-[10px] text-muted-foreground">edited {f.edits}x</span> : null}</span>
                      <Switch on={f.from} /><span className="text-muted-foreground" aria-hidden="true">→</span><Switch on={f.to} />
                      <span className="sr-only">{f.from ? 'was on' : 'was off'}, {f.to ? 'now on' : 'now off'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {day.measures.length > 0 && (
            <div className="min-w-[13rem] flex-1">
              <div className="mb-1 text-xs text-muted-foreground">Measurements</div>
              {day.measures.map((m) => {
                const max = Math.max(m.from ?? 0, m.to ?? 0) * 1.1 || 1;
                return (
                  <div key={m.label} className="py-1 text-[12.5px]">
                    <div className="flex justify-between gap-2">
                      <span>{m.label}</span>
                      <b>{m.from ?? 'none'} <span className="font-normal text-muted-foreground">→</span> {m.to ?? 'none'} <span className="font-normal text-muted-foreground">{m.unit}</span></b>
                    </div>
                    <div className="relative mt-1 h-1.5 rounded-full bg-slate-200" aria-hidden="true">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-400" style={{ width: `${((m.from ?? 0) / max) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full bg-teal-600/75" style={{ width: `${((m.to ?? 0) / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {day.texts.length > 0 && (
        <ul className={`${picture ? 'mt-3 ' : ''}flex flex-col gap-0.5 text-[12.5px] text-muted-foreground`}>
          {day.texts.map((t, i) => (
            <li key={`${t.label}-${i}`}><b className="text-foreground">{t.label}</b>{t.from ? <> {t.from} <span aria-hidden="true">→</span> </> : ' '}<span className="text-foreground">{t.to}</span></li>
          ))}
        </ul>
      )}

      {details && (
        <div role="table" aria-label={`All changes on ${day.label}`} className="mt-3 rounded-lg border border-border">
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
