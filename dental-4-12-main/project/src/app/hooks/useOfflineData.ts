import { useEffect, useSyncExternalStore } from 'react';
import { getOfflineDataStatus, subscribeOfflineData, loadOfflineDataStatus, type OfflineDataStatus } from '../offline/bulkSync';

/** How much of the roster is downloaded for offline use on this device. */
export function useOfflineData(): OfflineDataStatus {
  useEffect(() => { void loadOfflineDataStatus(); }, []);
  return useSyncExternalStore(subscribeOfflineData, getOfflineDataStatus);
}
