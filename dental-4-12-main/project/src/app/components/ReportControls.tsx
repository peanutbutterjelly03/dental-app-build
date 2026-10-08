import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown, Filter, FileSpreadsheet, FileText, Printer, X } from 'lucide-react';

// Parts of the control panel on every Reports tab (user-approved look,
// 2026-10-08): a white card attached under the tab strip (PanelShell) holding
// one row of equal-size outlined boxes (GroupBox: "Time period", "Dates",
// "School year") with the Excel / PDF / Print buttons at the right end
// (ActionGroup). Excel is always the green gradient, PDF soft orange, Print
// soft blue. Internal Reports adds underlined tabs and a Filters button.
//
// ⚠ Show only controls that really filter the data and only buttons the tab
// really supports (CLAUDE.md, NOTHING COSMETIC).

type Icon = ComponentType<{ className?: string }>;

export interface TileOption<T extends string> { v: T; label: string; hint: string; icon: Icon }

export type PeriodKindName = 'range' | 'month' | 'quarter' | 'half' | 'year';
const SPANS: Record<PeriodKindName, { label: string; caption: string; months: number | null }> = {
  range: { label: 'Range', caption: 'Pick dates', months: null },
  month: { label: 'Month', caption: '1 month', months: 1 },
  quarter: { label: 'Quarter', caption: '3 months', months: 3 },
  half: { label: 'Half', caption: '6 months', months: 6 },
  year: { label: 'Year', caption: '12 months', months: 12 },
};

/** The Time period switch (user pick "A", 2026-10-08): five separate tiles, the
 *  chosen tile solid navy, each cell with its length in words and a 12-cell bar that
 *  shows how much of a year it covers (a dashed bar for Range, whose length is
 *  up to the user). The bar is only a picture of the length, never of which
 *  month is chosen. */
export function PeriodSwitch<T extends string>({ value, onChange, options, name }: {
  value: T; onChange: (v: T) => void; options: { v: T; kind: PeriodKindName }[]; name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid w-full grid-cols-5 gap-2">
      {options.map(({ v, kind }) => {
        const on = v === value;
        const sp = SPANS[kind];
        return (
          <button key={v} type="button" role="radio" aria-checked={on} title={sp.caption} onClick={() => onChange(v)}
            className={`min-w-0 rounded-[10px] border-[1.5px] px-1.5 py-2 text-center ${on ? 'border-primary bg-primary text-white' : 'border-[#dfe5f0] bg-white text-primary hover:border-[#c9d4ec] hover:bg-primary/5'}`}>
            <div className="text-[12.5px] font-bold">{sp.label}</div>
            <div className={`text-[10.5px] font-normal ${on ? 'text-[#c9d4ec]' : 'text-[#7a859b]'}`}>{sp.caption}</div>
            {sp.months === null ? (
              <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-sm" style={{ background: `repeating-linear-gradient(90deg, ${on ? '#fff' : '#9fb0d6'} 0 4px, transparent 4px 6px)` }} />
            ) : (
              <div aria-hidden="true" className="mt-1.5 grid grid-cols-12 gap-0.5">
                {Array.from({ length: 12 }, (_, k) => (
                  <i key={k} className={`block h-1.5 rounded-sm ${k < (sp.months as number) ? (on ? 'bg-[#f3c33d]' : 'bg-primary') : (on ? 'bg-white/30' : 'bg-[#dfe5f0]')}`} />
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A soft segmented switch: one choice at a time, the chosen one a white chip.
 *  (Kept the PeriodTiles name; `icons` adds each option's icon.) */
export function PeriodTiles<T extends string>({ value, onChange, options, name, icons = false, full = false }: {
  value: T; onChange: (v: T) => void; options: TileOption<T>[]; name: string; icons?: boolean; full?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={`gap-0.5 overflow-x-auto rounded-xl bg-[#eef1f7] p-1 ${full ? 'flex w-full' : 'inline-flex max-w-full'}`}>
      {options.map(({ v, label, hint, icon: I }) => {
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} title={hint} onClick={() => onChange(v)}
            className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold sm:h-7 ${full ? 'flex-1 justify-center' : ''} ${on ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {icons && <I className="h-4 w-4" aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export const fieldInputClass = 'h-full min-w-0 appearance-none !border-0 !bg-transparent !p-0 !pr-6 !shadow-none text-[12.5px] font-bold text-muted-foreground focus:!outline-none';

const KINDS = {
  excel: { icon: FileSpreadsheet, label: 'Excel', cls: 'bg-gradient-to-b from-[#1f9a52] to-[#16813f] text-white shadow-[0_6px_12px_-6px_rgba(22,129,63,0.7)] hover:brightness-95' },
  pdf: { icon: FileText, label: 'PDF', cls: 'bg-[#fff3ea] text-[#c2410c] hover:bg-[#ffe8d6]' },
  print: { icon: Printer, label: 'Print', cls: 'bg-[#eef2fb] text-primary hover:bg-[#e2e9f8]' },
} as const;

/** `caption` says what the file is for; shown as a tooltip to keep the bar short. */
export function ActionButton({ kind, caption, onClick, disabled, busy }: {
  kind: keyof typeof KINDS; caption: string; onClick: () => void; disabled?: boolean; busy?: boolean;
}) {
  const k = KINDS[kind];
  const I = k.icon;
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} title={caption}
      className={`flex h-11 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-bold disabled:opacity-60 sm:h-10 ${k.cls}`}>
      <I className="h-4 w-4 flex-none" aria-hidden="true" />
      {busy ? 'Preparing…' : k.label}
    </button>
  );
}

// ── Internal Reports panel parts (user-approved 2026-10-08) ────────────────

/** The attached white card with no layout of its own, for panels made of rows. */
export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="doh-report-controls -mt-4 rounded-b-2xl border border-t-0 border-[#e1e7f3] bg-white px-5 pb-5 shadow-[0_14px_30px_-18px_rgba(36,59,122,0.45)]">
      {children}
    </div>
  );
}

/** Underlined tabs with an optional control at the far right (Print). The
 *  faint rule under them runs only half the card, so it never reaches Print;
 *  the chosen tab has a yellow underline (the sidebar's gold). */
export function UnderlineTabs<T extends string>({ value, onChange, options, name, trailing }: {
  value: T; onChange: (v: T) => void; options: { v: T; label: string; icon: Icon }[]; name: string; trailing?: ReactNode;
}) {
  return (
    <div className="relative flex flex-wrap items-center gap-x-6">
      <span aria-hidden="true" className="absolute bottom-0 left-0 h-px w-1/2 bg-[#e4e9f3]" />
      <div role="tablist" aria-label={name} className="relative flex flex-wrap gap-x-6">
        {options.map(({ v, label, icon: I }) => {
          const on = v === value;
          return (
            <button key={v} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-[3px] pb-3 pt-4 text-[12.5px] ${on ? 'border-[#f3c33d] font-bold text-primary' : 'border-transparent font-semibold text-muted-foreground hover:text-foreground'}`}>
              <I className="h-3.5 w-3.5" aria-hidden="true" />{label}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto py-2">{trailing}</div>}
    </div>
  );
}

/** A fieldset-style box: the title is cut into its border. Every box is the
 *  same height so a row of them lines up. */
export function GroupBox({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative flex min-h-[86px] items-center rounded-[14px] border border-[#dfe5f0] bg-white px-3.5 pb-1 pt-2 ${className}`}>
      <span className="absolute -top-2 left-3 bg-white px-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

/** A caption over an underlined field: the native control goes inside. */
export function Underlined({ label, icon: I, chevron = false, children }: { label?: string; icon: Icon; chevron?: boolean; children: ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 lg:min-w-[9rem] lg:flex-none">
      {label && <div className="text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{label}</div>}
      <div className="relative flex h-9 items-center gap-2 border-b-[1.5px] border-primary">
        <I className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
        {children}
        {chevron && <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </div>
    </div>
  );
}

/** Grey Filters button with a count badge; its menu holds the controls. */
export function FiltersButton({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-2 rounded-[10px] border border-[#e3e7ef] bg-[#f1f3f8] px-3.5 text-[13.5px] font-bold text-[#46536d] hover:bg-[#e9ecf3] sm:h-10">
        <Filter className="h-4 w-4 text-[#7a859b]" aria-hidden="true" />
        Filters
        <span className="rounded-full bg-[#4b5568] px-[7px] text-[11px] leading-[17px] text-white">{count}</span>
        <ChevronDown className="h-4 w-4 text-[#7a859b]" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#dfe6f4] bg-white p-3 shadow-[0_18px_34px_-14px_rgba(20,33,61,0.45)]">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">Students</div>
          <div className="flex flex-col gap-2">{children}</div>
        </div>
      )}
    </div>
  );
}

/** A removable chip for one active filter. */
export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#e3e7ef] bg-[#f1f3f8] pl-3 pr-2 text-[12.5px] font-semibold text-[#46536d]">
      {children}
      <button type="button" onClick={onRemove} aria-label={`Remove ${typeof children === 'string' ? children : 'filter'}`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-[#dfe3ec]">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/** Every box in a row is this wide on a laptop, full width below it. */
export const BOX_W = 'w-full lg:w-[400px]';

/** One row of boxes and buttons, under the card's top edge. */
export function PanelRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-5 pt-6">{children}</div>;
}

/** The buttons at the right end of a row (Excel, PDF, Print). */
export function ActionGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{children}</div>;
}

/** A grey button that opens something (rows and columns), same look as Filters. */
export function GreyButton({ icon: I, expanded, onClick, children }: { icon: Icon; expanded: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={expanded} onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-[10px] border border-[#e3e7ef] bg-[#f1f3f8] px-3.5 text-[13.5px] font-bold text-[#46536d] hover:bg-[#e9ecf3] sm:h-10">
      <I className="h-4 w-4 text-[#7a859b]" aria-hidden="true" />
      {children}
      <ChevronDown className="h-4 w-4 text-[#7a859b]" aria-hidden="true" />
    </button>
  );
}
