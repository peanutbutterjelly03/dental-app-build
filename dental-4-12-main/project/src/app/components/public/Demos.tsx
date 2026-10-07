import { useState } from 'react';
import { LOWER_TEETH, RPC_STEPS, UPPER_TEETH } from './publicContent';

// Small, self-contained previews for the About page. They hold their own state and
// never call the API: nothing here is a record.

const frame = 'mt-5 rounded-2xl border border-dashed border-sky-300/40 bg-sky-400/10 p-4';
const label = 'mb-3 flex flex-wrap justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-blue-100/70';

type Tooth = '' | 'D' | 'F' | 'M';
const NEXT: Record<Tooth, Tooth> = { '': 'D', D: 'F', F: 'M', M: '' };
const TOOTH_STYLE: Record<Tooth, string> = {
  '': 'border-white/25 bg-white/10 text-white/70',
  D: 'border-red-400 bg-red-100 text-red-900',
  F: 'border-blue-400 bg-blue-100 text-blue-900',
  M: 'border-gray-400 bg-gray-200 text-gray-600',
};

export const ToothChartDemo = () => {
  const [teeth, setTeeth] = useState<Record<string, Tooth>>({});
  const cycle = (n: string) => setTeeth((s) => ({ ...s, [n]: NEXT[s[n] ?? ''] }));
  const count = (k: Tooth) => Object.values(teeth).filter((v) => v === k).length;
  const arch = (list: string[]) => (
    <div className="grid grid-cols-8 gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
      {list.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => cycle(n)}
          aria-label={`Tooth ${n}: ${{ '': 'healthy', D: 'decayed', F: 'filled', M: 'missing' }[teeth[n] ?? '']}. Tap to change.`}
          className={`flex aspect-[0.8] items-end justify-center rounded-t-md rounded-b-xl border-[1.5px] pb-0.5 text-[10px] font-bold transition hover:scale-105 ${TOOTH_STYLE[teeth[n] ?? '']}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
  const stat = (k: string, v: number) => (
    <div className="flex-1 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2 text-xs text-blue-100/80">
      <b className="block text-2xl tabular-nums text-white">{v}</b>{k}
    </div>
  );
  return (
    <div className={frame}>
      <div className={label}><span>Try it: tap a tooth to cycle healthy, decayed, filled, missing</span><span>Example chart</span></div>
      <div className="grid gap-2">{arch(UPPER_TEETH)}{arch(LOWER_TEETH)}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {stat('Decayed', count('D'))}{stat('Missing', count('M'))}{stat('Filled', count('F'))}{stat('DMFT', count('D') + count('M') + count('F'))}
      </div>
    </div>
  );
};

export const RpcDemo = () => {
  const [visit, setVisit] = useState<1 | 2>(1);
  const [done, setDone] = useState<Record<number, boolean[]>>({ 1: [false, false, false, false, false], 2: [false, false, false, false, false] });
  const n = done[visit].filter(Boolean).length;
  const toggle = (i: number) => setDone((d) => ({ ...d, [visit]: d[visit].map((v, j) => (j === i ? !v : v)) }));
  return (
    <div className={frame}>
      <div className={label}><span>Try it: tick the steps completed</span><span>Example student</span></div>
      <div className="mb-3 flex gap-1.5">
        {([1, 2] as const).map((v) => (
          <button key={v} type="button" aria-pressed={visit === v} onClick={() => setVisit(v)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${visit === v ? 'border-sky-400 bg-sky-400 text-[#06204A]' : 'border-white/25 bg-white/10 text-white'}`}>
            Visit {v}
          </button>
        ))}
      </div>
      {RPC_STEPS.map((s, i) => (
        <label key={s} className="flex cursor-pointer items-center gap-3 border-b border-white/15 py-2.5 text-sm">
          <input type="checkbox" checked={done[visit][i]} onChange={() => toggle(i)} className="h-[18px] w-[18px] accent-sky-400" />
          {s}
        </label>
      ))}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-sky-400 transition-all" style={{ width: `${n * 20}%` }} /></div>
      <p className="mt-1.5 text-xs text-blue-100/70">{n} of 5 steps done for visit {visit}</p>
    </div>
  );
};

export const RiskDemo = () => {
  const [state, setState] = useState<'pending' | 'validated' | 'changed'>('pending');
  const pill = state === 'changed' ? ['High', 'bg-red-100 text-red-800'] : ['Medium', 'bg-amber-100 text-amber-800'];
  return (
    <div className={frame}>
      <div className={label}><span>Try it: the dentist decides</span><span>Example output</span></div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${pill[1]}`}>{state === 'pending' ? 'Suggested: Medium' : pill[0]}</span>
        <span className={`text-sm ${state === 'pending' ? 'text-blue-100/70' : 'font-bold text-green-300'}`}>
          {state === 'pending' ? 'Waiting for the dentist' : state === 'validated' ? 'Validated by the dentist' : 'Dentist changed the risk level'}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setState('validated')} className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-bold text-[#06204A]">Validate</button>
        <button type="button" onClick={() => setState('changed')} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold">Change to High</button>
        <button type="button" onClick={() => setState('pending')} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold">Reset</button>
      </div>
      <p className="mt-3 text-xs text-blue-100/70">Main input: DMF and dmf index. Also read: oral conditions, diet, medical and treatment history.</p>
    </div>
  );
};
