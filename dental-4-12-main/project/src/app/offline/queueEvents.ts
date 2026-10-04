// IndexedDB has no built-in change notifications for same-tab listeners,
// so this is a minimal event bus other modules/components subscribe to
// whenever the write queue changes (enqueue, sync success, sync failure).
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Asks the conflict-review dialog (components/ConflictReviewDialog.tsx) to open:
// from the "back online" summary and from the sync panel.
const reviewListeners = new Set<Listener>();
export function subscribeConflictReview(listener: Listener): () => void {
  reviewListeners.add(listener);
  return () => reviewListeners.delete(listener);
}
// True while that dialog is on screen. Resolving a conflict triggers a sync, and
// its "back online" summary must not pop up over the very dialog being used.
let conflictReviewOpen = false;
export const setConflictReviewOpen = (open: boolean) => { conflictReviewOpen = open; };
export const isConflictReviewOpen = () => conflictReviewOpen;
export function requestConflictReview(): void {
  for (const listener of reviewListeners) listener();
}

export function notifyQueueChange(): void {
  for (const listener of listeners) listener();
}
