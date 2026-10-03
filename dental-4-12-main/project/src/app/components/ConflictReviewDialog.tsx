import { useEffect, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Modal } from './Modal';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { keepMyChange, discardMyChange } from '../offline/queueProcessor';
import { subscribeConflictReview, setConflictReviewOpen } from '../offline/queueEvents';
import { describeWrite } from '../offline/describeWrite';
import { conflictFields, serverChangedAt, recordLabel } from '../offline/conflictView';
import type { QueuedWrite } from '../offline/db';

// The "what changed while you were offline" review. A change saved on this device
// found the record already edited elsewhere, so nothing was overwritten: each one
// waits here, your version beside the server's, with the fields the server changed
// under you called out. Nothing is chosen automatically, and each choice asks to
// be confirmed (after RAMHIS's ConflictManager).
//
// Opened from the "back online" summary and from the sync panel. Closes itself
// when nothing is left to review.
const when = (value: number | string | null) => {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

type Choice = 'mine' | 'server';

const ConflictCard = ({ write }: { write: QueuedWrite }) => {
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const described = describeWrite(write);
  const { module, kind } = described;
  const detail = described.detail ?? recordLabel(write);
  const fields = conflictFields(write);
  const savedAt = when(write.timestamp);
  const changedAt = when(serverChangedAt(write));

  const apply = async (choice: Choice) => {
    setBusy(true);
    try {
      if (choice === 'mine') await keepMyChange(write.id!);
      else await discardMyChange(write.id!);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-800">{module}</p>
      <h3 className="mt-0.5 text-base font-semibold text-foreground">
        {kind}{detail ? `: ${detail}` : ''}
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {savedAt && <>You saved this on this device on {savedAt}. </>}
        {changedAt ? <>The server copy was last changed on {changedAt}.</> : <>The server copy was changed by someone else.</>}
      </p>

      {fields.length === 0 ? (
        <p className="mt-3 rounded-lg bg-card p-3 text-sm text-muted-foreground">
          Both versions now agree on every field you changed. Using either one gives the same record.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Your version</th>
                <th className="px-3 py-2 font-medium">Server version</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.field} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-muted-foreground">{f.field}</td>
                  <td className="px-3 py-2 font-medium text-blue-700">{f.mine}</td>
                  <td className="px-3 py-2 font-medium text-orange-700">
                    {f.server}
                    {f.serverChanged && (
                      <span className="mt-0.5 block text-xs font-normal text-orange-800">
                        Changed on the server{f.started !== null ? `. You started from: ${f.started}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-label="Confirm this version">
          <p className="text-sm text-amber-900">
            {confirming === 'mine'
              ? 'Your version will be sent and will replace what the server has for these fields.'
              : 'Your version will be discarded and the server version stays as it is.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => apply(confirming)}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Saving...' : confirming === 'mine' ? 'Yes, use my version' : 'Yes, use the server version'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming('mine')}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Use my version
          </button>
          <button
            type="button"
            onClick={() => setConfirming('server')}
            className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Use the server version
          </button>
        </div>
      )}
    </section>
  );
};

export const ConflictReviewDialog = () => {
  const { conflicts } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeConflictReview(() => setOpen(true)), []);
  useEffect(() => {
    setConflictReviewOpen(open);
    return () => setConflictReviewOpen(false);
  }, [open]);
  useEffect(() => {
    if (open && conflicts.length === 0) setOpen(false);
  }, [open, conflicts.length]);

  if (!open) return null;
  const close = () => setOpen(false);

  return (
    <Modal onClose={close} maxWidth="max-w-3xl">
      <div className="px-6 pt-6 pb-3 flex items-start gap-3">
        <GitCompareArrows className="h-6 w-6 flex-shrink-0 text-orange-600" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Changes made while you were offline need review</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {conflicts.length} change{conflicts.length === 1 ? '' : 's'} could not be saved on their own because the record was edited elsewhere in the meantime. Nothing has been overwritten.
          </p>
        </div>
      </div>
      <div className="px-6 pb-2 space-y-4">
        {conflicts.map((write) => (
          <ConflictCard key={write.id} write={write} />
        ))}
      </div>
      <div className="px-6 py-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Nothing is chosen for you. Review later keeps every change on this device.</p>
        <button
          type="button"
          onClick={close}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Review later
        </button>
      </div>
    </Modal>
  );
};
