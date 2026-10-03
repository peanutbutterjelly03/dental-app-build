import { useEffect, useState, useCallback } from 'react';
import { getQueue, type QueuedWrite } from '../offline/db';
import { subscribeQueueChange } from '../offline/queueEvents';

export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedWrite[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const reload = useCallback(() => {
    getQueue().then(setQueue).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    const unsubscribe = subscribeQueueChange(reload);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [reload]);

  return {
    queue,
    isOnline,
    pendingCount: queue.filter((w) => w.status === 'pending').length,
    failed: queue.filter((w) => w.status === 'failed'),
    authBlocked: queue.filter((w) => w.status === 'auth'),
    conflicts: queue.filter((w) => w.status === 'conflict'),
  };
}

// Helper for hooks (useStudents, useAppointments, etc.) to find queued
// writes targeting a specific endpoint, so they can merge pending records
// into their displayed lists as optimistic entries.
export function usePendingWritesFor(endpoint: string) {
  const { queue } = useOfflineQueue();
  return queue.filter((w) => w.endpoint === endpoint && w.method === 'POST');
}
