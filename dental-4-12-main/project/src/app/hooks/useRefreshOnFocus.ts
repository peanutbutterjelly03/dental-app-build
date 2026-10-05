import { useEffect } from 'react';

/**
 * Re-run `load` when the user comes back to the tab.
 *
 * Sprint 44 built this for the DOH Consolidated report; Sprint 104 extracted it
 * because it was the only one of sixteen hooks that had it, and nobody chose
 * that — it is simply where Sprint 44 stopped. A report that is live while the
 * one beside it is stale is worse than neither being live, because there is no
 * way to tell them apart on screen.
 *
 * ⚠ AN INTERVAL IS THE WRONG SHAPE HERE, and that is a decision, not an
 * omission. What matters is that the numbers are current at the moment someone
 * LOOKS at them — not that they tick while nobody is watching. On a serverless
 * plan every tick is a billed invocation, so polling would spend real money to
 * keep an unwatched tab warm. Focus-refresh costs nothing while idle.
 *
 * ⚠ READ-ONLY SCREENS ONLY. This refetches without asking, so on a screen
 * holding unsaved edits it would silently overwrite them. Reports are safe
 * precisely because they are read-only; do not add this to a form hook
 * (useDentalChartData, the student forms) without solving that first.
 *
 * @param load     the loader to re-run. Memoise it (useCallback) — an unstable
 *                 reference re-subscribes on every render.
 * @param enabled  pass false to opt out without breaking the hook order.
 */
export function useRefreshOnFocus(load: () => void | Promise<unknown>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    // Throttled so alt-tabbing does not re-run several collection reads
    // repeatedly. Held in the effect rather than in state: it must not cause a
    // render, and it resets naturally when `load` changes identity.
    let lastRefresh = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh < REFRESH_THROTTLE_MS) return;
      lastRefresh = Date.now();
      void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    // `online` matters as much as focus: a report read while offline shows
    // whatever the service worker had, and should correct itself on reconnect.
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [load, enabled]);
}

/** 30s. Long enough that alt-tabbing between two windows does not thrash the
 *  API, short enough that a number someone walks back to is current. */
export const REFRESH_THROTTLE_MS = 30 * 1000;
