import { useEffect, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Modal } from './Modal';
import { apiClient } from '../api/client';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { keepMyChange, discardMyChange, useOtherVersion, dismissResolvedConflict } from '../offline/queueProcessor';
import { subscribeConflictReview, setConflictReviewOpen } from '../offline/queueEvents';
import { describeWrite } from '../offline/describeWrite';
import { conflictFields, serverChangedAt, recordLabel, type ConflictField } from '../offline/conflictView';
import { conflictTarget } from '../offline/syncEnvelope';
import type { QueuedWrite } from '../offline/db';

// The "what changed while you were offline" review. A change saved on this device
// found the record already edited elsewhere, so nothing was overwritten: each one
// waits here, your version beside the server's, with the fields the server changed
// under you called out. Edits other people made offline to the SAME record, and
// are still waiting, are listed too. Nothing is chosen automatically, and each
// choice asks to be confirmed (after RAMHIS's ConflictManager).
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

/** What GET /api/sync-conflicts/record/:model/:id returns. */
interface ConflictGroup {
  current: Record<string, unknown>;
  candidates: { _id: string; owner: { name: string }; created_at: string; base: Record<string, unknown>; changes: Record<string, unknown> }[];
}

type Choice = { kind: 'mine' } | { kind: 'server' } | { kind: 'other'; id: string; name: string };

const FieldTable = ({ fields, yoursLabel }: { fields: ConflictField[]; yoursLabel: string }) => (
  <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
    <table className="w-full min-w-[30rem] text-left text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="px-3 py-2 font-medium">Field</th>
          <th className="px-3 py-2 font-medium">{yoursLabel}</th>
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
                  Changed on the server{f.started !== null ? `. Started from: ${f.started}` : ''}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ConflictCard = ({ write }: { write: QueuedWrite }) => {
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<ConflictGroup | null>(null);

  // The server's live record and everyone's waiting edits. Best effort: with no
  // connection the card still works from what this device captured.
  const target = conflictTarget(write.endpoint);
  useEffect(() => {
    if (!write.serverConflictId || !target) return;
    let cancelled = false;
    apiClient
      .get<ConflictGroup>(`/sync-conflicts/record/${target.model}/${target.recordId}`)
      .then((g) => { if (!cancelled) setGroup(g); })
      .catch(() => { /* offline or not allowed: fall back to the captured copy */ });
    return () => { cancelled = true; };
  }, [write.serverConflictId, target?.model, target?.recordId]);

  const serverRecord = group?.current ?? write.conflictServerRecord;
  const view = { body: write.body, baselineSnapshot: write.baselineSnapshot, conflictServerRecord: serverRecord };
  const fields = conflictFields(view);
  const others = (group?.candidates ?? []).filter((c) => c._id !== write.serverConflictId);
  const settledElsewhere = !!group && !!write.serverConflictId && !group.candidates.some((c) => c._id === write.serverConflictId);

  const described = describeWrite(write);
  const detail = described.detail ?? recordLabel(view);
  const savedAt = when(write.timestamp);
  const changedAt = when(serverChangedAt(view));

  const apply = async (choice: Choice) => {
    setBusy(true);
    setError(null);
    try {
      if (choice.kind === 'mine') await keepMyChange(write.id!);
      else if (choice.kind === 'server') await discardMyChange(write.id!);
      else await useOtherVersion(write.id!, choice.id);
      setConfirming(null);
    } catch (err) {
      // Could not reach the server, or it refused: nothing was decided, nothing lost.
      setError(err instanceof Error ? err.message : 'That choice could not be saved. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmText =
    confirming?.kind === 'mine'
      ? 'Your version will be sent and will replace what the server has for these fields.'
      : confirming?.kind === 'server'
        ? 'Your version will be discarded and the server version stays as it is.'
        : confirming?.kind === 'other'
          ? `${confirming.name}'s version will be saved onto the record, and your version will be discarded.`
          : '';

  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-800">{described.module}</p>
      <h3 className="mt-0.5 text-base font-semibold text-foreground">
        {described.kind}{detail ? `: ${detail}` : ''}
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {savedAt && <>You saved this on this device on {savedAt}. </>}
        {changedAt ? <>The server copy was last changed on {changedAt}.</> : <>The server copy was changed by someone else.</>}
      </p>

      {settledElsewhere ? (
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <p className="text-sm text-foreground">Someone has already settled this record, so there is nothing left to decide here.</p>
          <button
            type="button"
            onClick={() => dismissResolvedConflict(write.id!)}
            className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Clear this from my list
          </button>
        </div>
      ) : (
        <>
          {fields.length === 0 ? (
            <p className="mt-3 rounded-lg bg-card p-3 text-sm text-muted-foreground">
              Both versions now agree on every field you changed. Using either one gives the same record.
            </p>
          ) : (
            <FieldTable fields={fields} yoursLabel="Your version" />
          )}

          {others.map((other) => {
            const theirs = conflictFields({ body: other.changes, baselineSnapshot: other.base, conflictServerRecord: serverRecord });
            const theirTime = when(other.created_at);
            return (
              <div key={other._id} className="mt-4 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                <p className="text-sm font-semibold text-foreground">
                  Also waiting on this record: {other.owner.name}
                  <span className="font-normal text-muted-foreground">{theirTime ? `, saved ${theirTime}` : ''}</span>
                </p>
                {theirs.length > 0 && <FieldTable fields={theirs} yoursLabel={`${other.owner.name}'s version`} />}
                {confirming?.kind !== 'other' || confirming.id !== other._id ? (
                  <button
                    type="button"
                    onClick={() => setConfirming({ kind: 'other', id: other._id, name: other.owner.name })}
                    className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {`Use ${other.owner.name}'s version`}
                  </button>
                ) : null}
              </div>
            );
          })}

          {confirming ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-label="Confirm this version">
              <p className="text-sm text-amber-900">{confirmText}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => apply(confirming)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : confirming.kind === 'mine' ? 'Yes, use my version' : confirming.kind === 'server' ? 'Yes, use the server version' : `Yes, use ${confirming.name}'s version`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setConfirming(null); setError(null); }}
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
                onClick={() => setConfirming({ kind: 'mine' })}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Use my version
              </button>
              <button
                type="button"
                onClick={() => setConfirming({ kind: 'server' })}
                className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Use the server version
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        </>
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
