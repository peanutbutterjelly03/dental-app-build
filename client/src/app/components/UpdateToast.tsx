import { X, RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// "New version available" toast. Pairs with registerType: 'prompt' in
// vite.config.ts and the SKIP_WAITING listener in sw.ts — after a deploy the
// new service worker waits until the user clicks Refresh, instead of open
// tabs silently running stale assets until a hard refresh.
// Hourly: often enough that a clinic PC left open all day picks up a deploy
// the same session, rare enough to be irrelevant against the offline budget.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// The interval alone leaves a window up to an hour wide where a tab someone
// just came back to is still running the old build. Checking when the tab
// becomes visible (or the window regains focus, or the connection returns)
// closes that: the common case is a tab left open in the background across a
// deploy, and returning to it is exactly when the user is about to act on
// stale code. Throttled so rapid alt-tabbing doesn't hammer the network.
const MIN_CHECK_GAP_MS = 60 * 1000;

export const UpdateToast = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Without this the toast can never appear on a tab that stays open: the
    // browser only re-checks sw.js on a real page load in scope, and SPA route
    // changes are client-side, so they never trigger a check. A deploy would
    // then go unnoticed until someone happened to press F5 — which is exactly
    // what happened after the Sprint 34/35 deploy.
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      let lastCheck = Date.now();
      const check = () => {
        if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
        lastCheck = Date.now();
        // update() rejects if the browser is offline or sw.js is unreachable;
        // that is expected here, not an error worth surfacing to the user.
        registration.update().catch(() => {});
      };

      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      // No teardown: UpdateToast is mounted once at the app root (App.tsx) and
      // lives for the tab's lifetime, so there is nothing to clean up.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
    },
  });

  // Guarantee the page reloads onto the new assets once the fresh service
  // worker takes control. vite-plugin-pwa's own reload doesn't reliably fire
  // with injectManifest, which made the Refresh button appear to "do nothing"
  // (the SW updated, but the tab kept showing the old build).
  const refresh = () => {
    navigator.serviceWorker?.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    void updateServiceWorker(true);
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white rounded-xl border border-gray-200 shadow-lg p-4 flex items-center gap-3 max-w-sm">
      <div className="text-sm text-foreground">A new version of FLORAL is available.</div>
      <button
        onClick={refresh}
        className="flex items-center gap-1.5 bg-[#1E40AF] hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss update notification"
        className="text-muted-foreground hover:text-muted-foreground shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
