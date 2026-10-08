import type { ComponentType, ReactNode } from 'react';
import { ChevronDown, CircleCheck, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';

// One control panel for every Reports tab (user-approved layout + style,
// 2026-10-08, "tinted band"): numbered steps side by side, the save/print
// buttons as the last column, and a plain sentence confirming what the person
// is looking at. Non-technical staff use
// this, so every control carries an icon and a label ABOVE it (never inside).
// Excel is always green, PDF orange, Print white — same order on every tab.
//
// ⚠ Show only controls that really filter the data and only buttons the tab
// really supports (CLAUDE.md, NOTHING COSMETIC).

type Icon = ComponentType<{ className?: string }>;

/** Attached under the tab strip: -mt-4 cancels the page's space-y gap. The
 *  steps are flex items that wrap, so a tab with many steps (Internal Reports)
 *  drops to a second row instead of squeezing. */
export function ControlsPanel({ steps, status, actions }: { steps: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="doh-report-controls -mt-4 flex flex-wrap items-start gap-x-6 gap-y-2 rounded-b-2xl border border-t-0 border-border bg-gradient-to-b from-[#eaf0fb] to-[#f6f8fd] px-4 py-2.5">
      {steps}
      {actions && <div className="min-w-0 lg:ml-auto">{actions}</div>}
      {status && (
        <div className="flex basis-full items-center gap-2 rounded-lg border border-[#d3dcf0] bg-white px-2.5 py-0.5 text-[12px] text-primary">
          <CircleCheck className="h-4 w-4 flex-none" aria-hidden="true" />
          <span className="min-w-0 [&_b]:font-bold [&_b]:text-foreground">{status}</span>
        </div>
      )}
    </div>
  );
}

const stepLabel = 'mb-1 flex items-center gap-1.5 text-[12.5px] font-bold text-primary';

export function Step({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full">
      <div className={stepLabel}>
        <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-primary text-[10px] text-white">{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

export interface TileOption<T extends string> { v: T; label: string; hint: string; icon: Icon }

/** A segmented switch: one choice at a time, the chosen one solid. (Kept the
 *  PeriodTiles name; `icons` adds each option's icon for non-period choices.) */
export function PeriodTiles<T extends string>({ value, onChange, options, name, icons = false }: {
  value: T; onChange: (v: T) => void; options: TileOption<T>[]; name: string; icons?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex max-w-full overflow-x-auto rounded-lg border-[1.5px] border-primary bg-white">
      {options.map(({ v, label, hint, icon: I }) => {
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} title={hint} onClick={() => onChange(v)}
            className={`flex min-h-[44px] sm:min-h-[30px] items-center gap-1.5 whitespace-nowrap border-r border-[#c9d4ec] px-2.5 py-0.5 text-[12.5px] font-bold last:border-r-0 ${on ? 'bg-primary text-white' : 'text-primary hover:bg-primary/10'}`}>
            {icons && <I className="h-4 w-4" aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** A native <select> (or any native input) with its icon in front. The
 *  select's own border/background are stripped (the app's global select style
 *  would draw a second box inside this one) and a chevron is drawn instead;
 *  pass `chevron={false}` for a date input, which has its own picker icon. */
export function Field({ icon: I, children, chevron = true }: { icon: Icon; children: ReactNode; chevron?: boolean }) {
  return (
    <div className="relative flex min-h-[44px] sm:min-h-[30px] min-w-[10rem] flex-1 items-center gap-2 rounded-lg border-[1.5px] border-primary bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
      <I className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
      {children}
      {chevron && <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-primary" aria-hidden="true" />}
    </div>
  );
}
export const fieldInputClass = 'min-w-0 flex-1 appearance-none !border-0 !bg-transparent !p-0 !pr-6 !shadow-none py-0 text-[12.5px] font-bold text-primary focus:!outline-none';

/** The last column. `n` numbers it like the steps; without it a save icon leads. */
export function ActionBox({ title = 'Save this report', n, children }: { title?: string; n?: number; children: ReactNode }) {
  return (
    <div>
      <div className={stepLabel}>
        {n ? <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-primary text-[10px] text-white">{n}</span>
          : <Download className="h-4 w-4" aria-hidden="true" />}
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const KINDS = {
  excel: { icon: FileSpreadsheet, label: 'Excel', cls: 'border-green-700 bg-green-700 text-white hover:bg-green-800' },
  pdf: { icon: FileText, label: 'PDF', cls: 'border-orange-700 bg-white text-orange-700 hover:bg-orange-50' },
  print: { icon: Printer, label: 'Print', cls: 'border-primary bg-white text-primary hover:bg-primary/10' },
} as const;

/** `caption` says what the file is for; shown as a tooltip to keep the bar short. */
export function ActionButton({ kind, caption, onClick, disabled, busy }: {
  kind: keyof typeof KINDS; caption: string; onClick: () => void; disabled?: boolean; busy?: boolean;
}) {
  const k = KINDS[kind];
  const I = k.icon;
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} title={caption}
      className={`flex min-h-[44px] sm:min-h-[30px] items-center gap-1.5 rounded-lg border-[1.5px] px-3 py-1 text-[12.5px] font-bold disabled:opacity-60 ${k.cls}`}>
      <I className="h-4 w-4 flex-none" aria-hidden="true" />
      {busy ? 'Preparing…' : k.label}
    </button>
  );
}
