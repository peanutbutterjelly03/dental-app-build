import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate, toLocalDateString } from '../utils/localDate';
import { Underlined } from './ReportControls';

// Start and end date for a report. Same date in both = one day. Dates are
// "YYYY-MM-DD" strings in local time (see utils/localDate.ts for why not UTC).
// Clicking a day sets that single day at once; a second click makes it the
// end of a range. The presets are real ranges, not decoration.

const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props { start: string; end: string; onChange: (start: string, end: string) => void }

export function RangePicker({ start, end, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [view, setView] = useState(() => { const d = parse(start); return { y: d.getFullYear(), m: d.getMonth() }; });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const today = new Date();
  const todayStr = toLocalDateString(today);
  const presets: { label: string; from: Date; to: Date }[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'This month', from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) },
  ];
  const pick = (a: Date, b: Date) => { onChange(toLocalDateString(a), toLocalDateString(b)); setAnchor(null); setOpen(false); };

  const clickDay = (day: string) => {
    if (anchor === null) { onChange(day, day); setAnchor(day); return; }
    const [a, b] = day < anchor ? [day, anchor] : [anchor, day];
    onChange(a, b); setAnchor(null); setOpen(false);
  };

  const first = new Date(view.y, view.m, 1);
  const lead = first.getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const shift = (n: number) => { const d = new Date(view.y, view.m + n, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const fieldBtn = 'min-w-0 flex-1 truncate bg-transparent text-left text-[12.5px] font-bold text-[#46536d] focus:outline-none';

  return (
    <div ref={box} className="relative flex w-full gap-4">
      <Underlined label="From" icon={Calendar}>
        <button type="button" className={fieldBtn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{formatDate(start)}</button>
      </Underlined>
      <Underlined label="To" icon={Calendar}>
        <button type="button" className={fieldBtn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{formatDate(end)}</button>
      </Underlined>
      {open && (
        <div role="dialog" aria-label="Choose dates" className="absolute left-0 top-full z-40 mt-3 flex max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl border border-[#dfe6f4] bg-white p-3 shadow-[0_18px_34px_-14px_rgba(20,33,61,0.45)] sm:flex-row sm:gap-4">
          <div className="flex gap-1 sm:w-[120px] sm:flex-col">
            {presets.map((p) => {
              const on = toLocalDateString(p.from) === start && toLocalDateString(p.to) === end;
              return (
                <button key={p.label} type="button" onClick={() => pick(p.from, p.to)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold ${on ? 'bg-[#e8eefc] text-primary' : 'text-[#46536d] hover:bg-[#f1f3f8]'}`}>{p.label}</button>
              );
            })}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg p-1 text-muted-foreground hover:bg-[#f1f3f8]"><ChevronLeft className="h-4 w-4" /></button>
              <b className="text-[13px]">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
              <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-lg p-1 text-muted-foreground hover:bg-[#f1f3f8]"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs" style={{ gridTemplateColumns: 'repeat(7, 32px)' }}>
              {WEEKDAYS.map((w, i) => <b key={i} className="py-1 text-[10px] text-muted-foreground">{w}</b>)}
              {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const day = toLocalDateString(new Date(view.y, view.m, i + 1));
                const isA = day === start, isZ = day === end, inside = day > start && day < end;
                const edge = isA || isZ;
                return (
                  <button key={day} type="button" onClick={() => clickDay(day)} aria-label={formatDate(day)} aria-pressed={edge}
                    className={`flex h-[30px] items-center justify-center text-[12px] ${edge ? 'bg-primary font-bold text-white' : inside ? 'bg-[#e8eefc] text-primary' : 'text-foreground hover:bg-[#f1f3f8]'} ${isA && isZ ? 'rounded-lg' : isA ? 'rounded-l-lg' : isZ ? 'rounded-r-lg' : inside ? '' : 'rounded-lg'} ${day === todayStr && !edge ? 'font-bold ring-1 ring-inset ring-primary/40' : ''}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 max-w-[236px] text-[11px] text-muted-foreground">Click a day, then a second day to make a range. Click the same day twice for one day.</p>
          </div>
        </div>
      )}
    </div>
  );
}
