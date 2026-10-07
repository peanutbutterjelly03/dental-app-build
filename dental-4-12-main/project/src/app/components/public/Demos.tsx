import { useState } from 'react';
import { LOWER_TEETH, UPPER_TEETH } from './publicContent';

// Small self-contained preview for the About page. It holds its own state and never
// calls the API: nothing here is a record.

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
