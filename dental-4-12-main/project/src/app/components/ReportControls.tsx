import type { ComponentType, ReactNode } from 'react';
import { ChevronDown, FileSpreadsheet, FileText, Printer } from 'lucide-react';

// One control panel for every Reports tab (user-approved look, 2026-10-08,
// "soft card"): a white panel under the tab strip with a soft shadow. Each
// control is a tinted icon chip with a small caption above its value, thin
// dividers between controls, and Excel / PDF / Print on the right.
// Excel is always the green gradient, PDF soft orange, Print soft blue.
//
// ⚠ Show only controls that really filter the data and only buttons the tab
// really supports (CLAUDE.md, NOTHING COSMETIC).

type Icon = ComponentType<{ className?: string }>;

/** Attached under the tab strip: -mt-4 cancels the page's space-y gap. The
 *  controls are flex items that wrap, so a tab with many (Internal Reports)
 *  drops to a second row instead of squeezing. `status` is read aloud by
 *  screen readers when it changes and is not drawn (the controls already show
 *  the choice). */
export function ControlsPanel({ steps, status, actions }: { steps: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="doh-report-controls -mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-b-2xl border border-t-0 border-[#e1e7f3] bg-white px-4 py-3 shadow-[0_14px_30px_-18px_rgba(36,59,122,0.45)]">
      {steps}
      {actions && <div className="flex min-w-0 flex-wrap gap-2 lg:ml-auto">{actions}</div>}
      {status && <p className="sr-only" aria-live="polite">{status}</p>}
    </div>
  );
}

const TONES = { blue: 'bg-[#e8eefc] text-primary', violet: 'bg-[#f1ecfd] text-[#6d4bd6]' } as const;

/** One control: a coloured icon chip, a small caption, then the control. */
export function Step({ icon: I, label, tone = 'blue', children }: {
  icon: Icon; label: string; tone?: keyof typeof TONES; children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2.5 border-[#e4e9f3] sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg ${TONES[tone]}`}>
        <I className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{label}</div>
        {children}
      </div>
    </div>
  );
}

export interface TileOption<T extends string> { v: T; label: string; hint: string; icon: Icon }

/** A soft segmented switch: one choice at a time, the chosen one a white chip.
 *  (Kept the PeriodTiles name; `icons` adds each option's icon.) */
export function PeriodTiles<T extends string>({ value, onChange, options, name, icons = false }: {
  value: T; onChange: (v: T) => void; options: TileOption<T>[]; name: string; icons?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="mt-0.5 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-[#eef1f7] p-1">
      {options.map(({ v, label, hint, icon: I }) => {
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} title={hint} onClick={() => onChange(v)}
            className={`flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-[13px] font-semibold sm:min-h-[28px] ${on ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {icons && <I className="h-4 w-4" aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** A native <select> (or any native input) shown as bold text with a chevron.
 *  The select's own border/background are stripped (the app's global select
 *  style would draw a box). Pass `chevron={false}` for a date input, which has
 *  its own picker icon. */
export function Field({ children, chevron = true }: { icon?: Icon; children: ReactNode; chevron?: boolean }) {
  return (
    <div className="relative flex min-h-[40px] items-center rounded-lg sm:min-h-[28px] focus-within:ring-2 focus-within:ring-ring">
      {children}
      {chevron && <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
    </div>
  );
}
export const fieldInputClass = 'min-w-0 appearance-none !border-0 !bg-transparent !p-0 !pr-6 !shadow-none text-[14px] font-bold text-foreground focus:!outline-none';

/** Same look as a Field, for a control that opens something (rows and grades). */
export function ValueButton({ onClick, expanded, children }: { onClick: () => void; expanded: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded}
      className="flex min-h-[40px] items-center gap-1.5 text-[14px] font-bold text-foreground sm:min-h-[28px]">
      {children}
      <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/** The right-hand group of save buttons. */
export function ActionBox({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

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
      className={`flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-60 sm:min-h-[34px] ${k.cls}`}>
      <I className="h-4 w-4 flex-none" aria-hidden="true" />
      {busy ? 'Preparing…' : k.label}
    </button>
  );
}
