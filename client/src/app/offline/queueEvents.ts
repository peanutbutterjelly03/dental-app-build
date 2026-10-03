// IndexedDB has no built-in change notifications for same-tab listeners,
// so this is a minimal event bus other modules/components subscribe to
// whenever the write queue changes (enqueue, sync success, sync failure).
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyQueueChange(): void {
  for (const listener of listeners) listener();
}
