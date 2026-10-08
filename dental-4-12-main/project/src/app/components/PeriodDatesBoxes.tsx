import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { GroupBox, PeriodSwitch, Underlined, fieldInputClass, type PeriodKindName } from './ReportControls';
import { RangePicker } from './RangePicker';
import { toLocalDateString } from '../utils/localDate';

// The "Time period" + "Dates" pair of boxes as a self-contained control, for a
// tab that shows them before anything reads their value. It keeps its own
// state and reports every change through `onChange`, so wiring it to data
// later is one prop. Same look and behaviour as the Internal Reports panel.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS: { v: PeriodKindName; kind: PeriodKindName }[] = [
  { v: 'range', kind: 'range' }, { v: 'month', kind: 'month' }, { v: 'quarter', kind: 'quarter' }, { v: 'half', kind: 'half' }, { v: 'year', kind: 'year' },
];

export interface PeriodDatesValue {
  kind: PeriodKindName;
  /** First and last day, "YYYY-MM-DD", inclusive. */
  start: string;
  end: string;
}

export function PeriodDatesBoxes({ onChange }: { onChange?: (v: PeriodDatesValue) => void }) {
  const now = new Date();
  const [kind, setKind] = useState<PeriodKindName>('range');
  const [pick, setPick] = useState(now.getMonth() + 1); // month 1-12, quarter 1-4, half 1-2
  const [year, setYear] = useState(now.getFullYear());
  const [rangeStart, setRangeStart] = useState(() => toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [rangeEnd, setRangeEnd] = useState(() => toLocalDateString(now));

  const emit = (k: PeriodKindName, p: number, y: number, rs: string, re: string) => {
    if (!onChange) return;
    if (k === 'range') return onChange({ kind: k, start: rs, end: re });
    const first = k === 'month' ? p : k === 'quarter' ? (p - 1) * 3 + 1 : k === 'half' ? (p - 1) * 6 + 1 : 1;
    const last = k === 'month' ? p : k === 'quarter' ? first + 2 : k === 'half' ? first + 5 : 12;
    onChange({ kind: k, start: toLocalDateString(new Date(y, first - 1, 1)), end: toLocalDateString(new Date(y, last, 0)) });
  };

  const changeKind = (k: PeriodKindName) => {
    const p = k === 'month' ? now.getMonth() + 1 : 1;
    setKind(k); setPick(p); emit(k, p, year, rangeStart, rangeEnd);
  };
  const years = Array.from(new Set([...[3, 2, 1, 0].map((i) => now.getFullYear() - i), year])).sort();

  return (
    <>
      <GroupBox title="Time period" className="w-full lg:w-[400px]">
        <PeriodSwitch<PeriodKindName> name="Time period" value={kind} onChange={changeKind} options={KINDS} />
      </GroupBox>
      <GroupBox title="Dates" className="w-full lg:w-auto lg:px-6">
        {kind === 'range' ? (
          <RangePicker start={rangeStart} end={rangeEnd} onChange={(a, b) => { setRangeStart(a); setRangeEnd(b); emit('range', pick, year, a, b); }} />
        ) : (
          <div className="flex w-full gap-5 lg:w-auto lg:gap-6">
            {kind !== 'year' && (
              <Underlined label={kind === 'month' ? 'Month' : kind === 'quarter' ? 'Quarter' : 'Half'} icon={Calendar} chevron>
                <select aria-label="Period" value={pick} className={`${fieldInputClass} !pr-5`}
                  onChange={(e) => { const n = Number(e.target.value); setPick(n); emit(kind, n, year, rangeStart, rangeEnd); }}>
                  {kind === 'month' && MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  {kind === 'quarter' && [1, 2, 3, 4].map((q) => <option key={q} value={q}>Quarter {q} ({MONTH_NAMES[(q - 1) * 3].slice(0, 3)} to {MONTH_NAMES[q * 3 - 1].slice(0, 3)})</option>)}
                  {kind === 'half' && [1, 2].map((h) => <option key={h} value={h}>{h === 1 ? '1st half (Jan to Jun)' : '2nd half (Jul to Dec)'}</option>)}
                </select>
              </Underlined>
            )}
            <Underlined label="Year" icon={Calendar} chevron>
              <select aria-label="Year" value={year} className={`${fieldInputClass} !pr-5`}
                onChange={(e) => { const n = Number(e.target.value); setYear(n); emit(kind, pick, n, rangeStart, rangeEnd); }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Underlined>
          </div>
        )}
      </GroupBox>
    </>
  );
}
