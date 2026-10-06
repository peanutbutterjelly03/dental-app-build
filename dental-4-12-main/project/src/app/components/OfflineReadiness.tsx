import { useSyncExternalStore } from 'react';
import { getOfflineReadiness, subscribeOfflineReadiness, retryOfflineWarm } from '../offline/offlineCache';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// Says how many of the queued students are saved on this device for offline use,
// so nobody has to guess when it is safe to disconnect.
export function OfflineReadiness() {
  const { ready, total, busy } = useSyncExternalStore(subscribeOfflineReadiness, getOfflineReadiness);
  const { isOnline } = useOfflineQueue();
  if (total === 0) return null;
  const done = ready >= total;
  let text: string;
  if (!isOnline) text = `Offline: ${ready} of ${total} queued students are available.`;
  else if (done) text = `Ready offline: all ${total} queued students are saved on this device.`;
  else if (busy) text = `Saving queued students for offline use: ${ready} of ${total}. Stay online until this finishes.`;
  else text = `${ready} of ${total} queued students are saved for offline use.`;
  return (
    <p className="mt-1 text-xs text-muted-foreground" role="status">
      {text}
      {isOnline && !done && !busy && (
        <button type="button" onClick={() => void retryOfflineWarm()} className="ml-2 font-semibold text-primary underline">Save the rest</button>
      )}
    </p>
  );
}
