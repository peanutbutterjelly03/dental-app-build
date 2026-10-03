import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { subscribeSyncReport, groupSyncReport, type SyncReportItem } from '../offline/syncReport';
import { requestConflictReview, isConflictReviewOpen } from '../offline/queueEvents';

// "Back online" summary. Opens when the offline queue finishes a drain and lists
// what happened to each change that was saved on this device — what reached the
// server, and anything that did not (with the reason). Mounted once, globally,
// so it appears wherever the person happens to be when the connection returns.
//
// A report arriving while the dialog is already open (a second drain) is added
// to it rather than replacing it, so nothing the person has not read yet is lost.
export const SyncReportDialog = () => {
  const [items, setItems] = useState<SyncReportItem[] | null>(null);

  useEffect(
    () => subscribeSyncReport((report) => {
      // While the conflict review is open, a change that synced is already shown
      // by its card disappearing; only something that did NOT sync may interrupt.
      const shown = isConflictReviewOpen() ? report.items.filter((i) => i.status !== 'synced') : report.items;
      if (shown.length > 0) setItems((prev) => [...(prev ?? []), ...shown]);
    }),
    [],
  );

  const groups = useMemo(() => (items ? groupSyncReport(items) : []), [items]);
  if (!items) return null;

  const problems = items.filter((i) => i.status !== 'synced').length;
  const synced = items.length - problems;
  const close = () => setItems(null);

  return (
    <Modal onClose={close} maxWidth="max-w-lg">
      <div className="px-6 pt-6 pb-4 flex items-start gap-3">
        {problems === 0
          ? <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" aria-hidden="true" />
          : <AlertTriangle className="h-6 w-6 flex-shrink-0 text-amber-600" aria-hidden="true" />}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {problems === 0 ? "You're back online" : 'Back online — some changes need attention'}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {synced > 0 && `${synced} change${synced === 1 ? '' : 's'} saved on this device ${synced === 1 ? 'was' : 'were'} synced.`}
            {synced > 0 && problems > 0 && ' '}
            {problems > 0 && `${problems} could not be synced.`}
          </p>
        </div>
      </div>

      <div className="px-6 pb-2 space-y-4">
        {groups.map((group) => (
          <section key={group.module}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{group.module}</h3>
            <ul className="space-y-1.5">
              {group.lines.map((line) => (
                <li key={`${line.kind}-${line.status}`} className="text-sm flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${line.status === 'synced' ? 'bg-green-600' : 'bg-amber-600'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="text-foreground">
                      {line.kind}{line.count > 1 ? ` ×${line.count}` : ''}
                      {line.count === 1 && line.details[0] ? ` — ${line.details[0]}` : ''}
                    </span>
                    {line.status !== 'synced' && (
                      <span className="block text-xs text-amber-800">
                        {line.status === 'conflict' ? 'Needs review: ' : line.status === 'auth' ? 'Sign in to sync: ' : 'Not saved: '}
                        {line.reasons.join(' ') || 'See the sync panel for details.'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="px-6 py-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {problems > 0 ? 'Changes that did not sync are kept — open the Online/Offline pill at the top to retry or review them.' : 'Nothing else to do.'}
        </p>
        <div className="flex flex-shrink-0 gap-2">
          {items.some((i) => i.status === 'conflict') && (
            <button
              type="button"
              onClick={() => { close(); requestConflictReview(); }}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Review changes
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
