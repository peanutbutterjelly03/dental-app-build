import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { retryQueue, discardFailedWrite, keepMyChange, discardMyChange } from '../offline/queueProcessor';
import type { QueuedWrite } from '../offline/db';

// "/appointments/6a44ad4..." -> "Appointment"
function describeResource(endpoint: string): string {
  const segment = endpoint.split('/').filter(Boolean)[0] ?? 'Record';
  const singular = segment.endsWith('ies') ? segment.slice(0, -3) + 'y' : segment.replace(/s$/, '');
  return singular
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// "appointment_datetime" -> "Appointment Datetime"
function humanizeField(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function describeChanges(write: QueuedWrite): { field: string; mine: string; current: string }[] {
  const body = (typeof write.body === 'object' && write.body ? write.body : {}) as Record<string, unknown>;
  const current = write.conflictServerRecord ?? {};
  return Object.keys(body)
    .filter((field) => !field.startsWith('_'))
    .map((field) => ({
      field: humanizeField(field),
      mine: formatValue(body[field]),
      current: formatValue(current[field]),
    }));
}

type Tone = 'offline' | 'syncing' | 'auth' | 'failed' | 'conflict' | 'idle';

// One compact status affordance instead of a full-width banner. It is
// deliberately ALWAYS mounted: connection state is something staff in the
// field need to be able to glance at, not something that only appears once
// there's a problem.
//
// ONE shape: a small coloured pill in Root's status strip, which opens the
// full sync panel. The floating round icon that used to hang in the top-right
// corner was deleted on request — it overlapped page content and duplicated
// what the strip already says.
export const SyncStatus = () => {
  const { isOnline, pendingCount, failed, authBlocked, conflicts } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const blocked = authBlocked.length > 0 ? authBlocked : failed;
  const isAuthBlock = authBlocked.length > 0;

  const tone: Tone = !isOnline
    ? 'offline'
    : authBlocked.length > 0
      ? 'auth'
      : failed.length > 0
        ? 'failed'
        : conflicts.length > 0
          ? 'conflict'
          : pendingCount > 0
            ? 'syncing'
            : 'idle';

  // Close on outside click and on Escape — a popover pinned over page content
  // that can only be dismissed by re-clicking the trigger is a trap on touch.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const chrome: Record<Tone, { ring: string; label: string }> = {
    offline: {
      ring: 'bg-amber-100 text-amber-700 border-amber-300',
      label: `Offline${pendingCount > 0 ? ` — ${pendingCount} change${pendingCount > 1 ? 's' : ''} saved locally` : ''}`,
    },
    syncing: {
      ring: 'bg-blue-100 text-blue-700 border-blue-300',
      label: `Syncing ${pendingCount} pending change${pendingCount > 1 ? 's' : ''}…`,
    },
    auth: {
      ring: 'bg-amber-100 text-amber-700 border-amber-300',
      label: 'Session expired — sign in again to sync',
    },
    failed: {
      ring: 'bg-red-100 text-red-700 border-red-300',
      label: "A change couldn't be saved",
    },
    conflict: {
      ring: 'bg-orange-100 text-orange-700 border-orange-300',
      label: `${conflicts.length} change${conflicts.length > 1 ? 's' : ''} need review`,
    },
    idle: {
      ring: 'bg-emerald-50 text-emerald-700 border-emerald-300',
      label: 'Online — everything synced',
    },
  };

  const { ring, label } = chrome[tone];

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[13px] font-semibold leading-none transition-colors ${ring}`}
      >
        <span className="w-[5px] h-[5px] rounded-full bg-current" aria-hidden="true" />
        {isOnline ? 'Online' : 'Offline'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sync status"
          className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto bg-card border border-border rounded-xl shadow-xl p-3 text-sm text-left font-normal normal-case leading-normal z-50"
        >
          <p className="font-semibold text-foreground mb-2">{label}</p>

          {tone === 'idle' && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="w-3.5 h-3.5 text-success" />
              No changes waiting to sync.
            </p>
          )}

          {tone === 'offline' && (
            <p className="text-xs text-muted-foreground">
              Changes are being saved on this device and will sync automatically once you're back online.
            </p>
          )}

          {tone === 'syncing' && (
            <p className="text-xs text-muted-foreground">Sending your queued changes to the server…</p>
          )}

          {blocked.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {isAuthBlock
                  ? 'Your session expired while you were away. Sign in again, then retry.'
                  : blocked[0].errorMessage ?? 'The server rejected it.'}
                {pendingCount > 0 && ` ${pendingCount} other change${pendingCount > 1 ? 's are' : ' is'} waiting behind it.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => retryQueue()}
                  className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                >
                  Retry
                </button>
                {!isAuthBlock && (
                  <button
                    onClick={() => discardFailedWrite(blocked[0].id!)}
                    className="px-2 py-1 rounded border border-border text-foreground text-xs font-medium hover:bg-muted"
                  >
                    Discard this change
                  </button>
                )}
              </div>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-foreground">
                Edited elsewhere while you were offline:
              </p>
              {conflicts.map((c) => (
                <div key={c.id} className="border border-orange-200 rounded-lg p-2 text-xs text-foreground bg-orange-50">
                  <p className="font-semibold mb-1.5">{describeResource(c.endpoint)} was changed by someone else</p>
                  <div className="overflow-x-auto">
                    <table className="w-full mb-2">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left font-medium pb-1">Field</th>
                          <th className="text-left font-medium pb-1">Yours</th>
                          <th className="text-left font-medium pb-1">Current</th>
                        </tr>
                      </thead>
                      <tbody>
                        {describeChanges(c).map((row) => (
                          <tr key={row.field}>
                            <td className="pr-2 py-0.5 text-muted-foreground">{row.field}</td>
                            <td className="pr-2 py-0.5 font-medium text-blue-700">{row.mine}</td>
                            <td className="py-0.5 font-medium text-orange-700">{row.current}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => keepMyChange(c.id!)}
                      className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                    >
                      Keep mine
                    </button>
                    <button
                      onClick={() => discardMyChange(c.id!)}
                      className="px-2 py-1 rounded border border-border text-foreground text-xs font-medium hover:bg-muted"
                    >
                      Discard mine
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
