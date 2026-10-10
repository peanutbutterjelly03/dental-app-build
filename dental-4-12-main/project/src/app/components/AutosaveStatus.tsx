import { CheckCircle2, CloudOff, Loader2, AlertCircle } from 'lucide-react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'queued' | 'error';

/** The one place autosave tells the person what happened. It replaces the Save
 *  button's label and the per-save toast: a change is saved the moment it is
 *  made, so what matters is whether it has reached the server yet. */
export function AutosaveStatus({ status, onRetry }: { status: AutosaveState; onRetry: () => void }) {
  if (status === 'idle') return <span className="text-xs text-muted-foreground" aria-live="polite">Changes save automatically</span>;
  if (status === 'saving') {
    return <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" aria-live="polite"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving</span>;
  }
  if (status === 'saved') {
    return <span className="flex items-center gap-1.5 text-xs font-medium text-success" aria-live="polite"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>;
  }
  if (status === 'queued') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-warning" aria-live="polite" title="No connection. This change is saved on this device and is sent when you are back online.">
        <CloudOff className="h-3.5 w-3.5" /> Saved on this device, will sync when online
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert">
      <AlertCircle className="h-3.5 w-3.5" /> Not saved
      <button type="button" onClick={onRetry} className="rounded-md border border-destructive px-2 py-0.5 text-xs font-semibold hover:bg-destructive/10">Retry</button>
    </span>
  );
}
