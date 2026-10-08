import type { ComponentType, ReactNode } from 'react';
import { CircleCheck, FileSpreadsheet, FileText, Printer } from 'lucide-react';

// One control panel for every Reports tab (user-approved layout, 2026-10-08):
// numbered steps on the left, a "Save or print" box on the right, and a plain
// sentence confirming what the person is looking at. Non-technical staff use
// this, so every control carries an icon and a label ABOVE it (never inside).
// Excel is always green, PDF orange, Print white — same order on every tab.
//
// ⚠ Show only controls that really filter the data and only buttons the tab
// really supports (CLAUDE.md, NOTHING COSMETIC).

type Icon = ComponentType<{ className?: string }>;

/** Attached under the tab strip: -mt-4 cancels the page's space-y gap. */
export function ControlsPanel({ steps, status, actions }: { steps: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="doh-report-controls -mt-4 grid gap-4 rounded-b-2xl border border-t-0 border-border bg-card p-4 sm:p-5 lg:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 flex-col gap-4">
        {steps}
        {status && (
          <div className="flex items-start gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm text-primary">
            <CircleCheck className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
            <span className="min-w-0">{status}</span>
          </div>
        )}
      </div>
      {actions}
    </div>
  );
}

export function Step({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary text-xs text-white">{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

export interface TileOption<T extends string> { v: T; label: string; hint: string; icon: Icon }

export function PeriodTiles<T extends string>({ value, onChange, options, name }: {
  value: T; onChange: (v: T) => void; options: TileOption<T>[]; name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={`grid grid-cols-2 gap-2 ${options.length > 3 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {options.map(({ v, label, hint, icon: I }) => {
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
            className={`flex min-h-[44px] flex-col items-center gap-0.5 rounded-xl border-[1.5px] px-2 py-2.5 text-center text-[13px] font-semibold transition-colors ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground hover:bg-gray-50'}`}>
            <I className="h-5 w-5" aria-hidden="true" />
            {label}
            <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A native <select> (or any native input) with its icon in front. */
export function Field({ icon: I, children }: { icon: Icon; children: ReactNode }) {
  return (
    <div className="flex min-h-[44px] min-w-[10rem] flex-1 items-center gap-2 rounded-xl border-[1.5px] border-primary/60 bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
      <I className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
      {children}
    </div>
  );
}
export const fieldInputClass = 'min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground focus:outline-none';

export function ActionBox({ title = 'Save or print this report', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-gray-50/60 p-3 lg:min-w-[15rem]">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <FileText className="h-5 w-5 text-primary" aria-hidden="true" />{title}
      </div>
      {children}
    </div>
  );
}

const KINDS = {
  excel: { icon: FileSpreadsheet, label: 'Excel file', cls: 'border-green-700 bg-green-700 text-white hover:bg-green-800', cap: 'text-green-100' },
  pdf: { icon: FileText, label: 'PDF file', cls: 'border-orange-600 bg-card text-orange-700 hover:bg-orange-50', cap: 'text-muted-foreground' },
  print: { icon: Printer, label: 'On paper', cls: 'border-border bg-card text-foreground hover:bg-gray-50', cap: 'text-muted-foreground' },
} as const;

export function ActionButton({ kind, caption, onClick, disabled, busy }: {
  kind: keyof typeof KINDS; caption: string; onClick: () => void; disabled?: boolean; busy?: boolean;
}) {
  const k = KINDS[kind];
  const I = k.icon;
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2 text-left text-sm font-bold disabled:opacity-60 ${k.cls}`}>
      <I className="h-5 w-5 flex-none" aria-hidden="true" />
      <span>{busy ? 'Preparing…' : k.label}<span className={`block text-[11.5px] font-normal ${k.cap}`}>{caption}</span></span>
    </button>
  );
}
