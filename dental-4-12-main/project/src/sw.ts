/// <reference lib="webworker" />
// Custom service worker (injectManifest mode, not generateSW) — needed
// because Sprint 20's background sync must run *our own* offline write
// queue (src/app/offline/), not Workbox's separate built-in queue, so the
// existing Sprint 19 queue stays the single source of truth.
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { processQueue } from './app/offline/queueProcessor';

declare const self: ServiceWorkerGlobalScope;

// No unconditional skipWaiting(): the new SW waits until the user clicks
// "Refresh" on the update toast (UpdateToast.tsx sends SKIP_WAITING). An
// auto-activating SW left open tabs running stale assets with no cue.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({ cacheName: 'google-fonts-cache' }),
);

// NetworkFirst for API reads: always prefer live data when there's any
// connection, only fall back to the last-cached response when the network
// genuinely fails. GET only — writes are handled entirely by the app's own
// offline queue (src/app/api/client.ts), never cached/replayed by the SW.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 4 }),
);

// Drains the same IndexedDB write queue Sprint 19 built, triggered by the
// Background Sync API — this is what lets queued writes sync even if the
// tab was closed while offline, not just while it's open (see
// registerBackgroundSync() in api/client.ts for where the tag gets registered).
//
// ⚠ SINCE SPRINT 159a THIS HOLDS EVERY ROW RATHER THAN SENDING IT, AND THAT IS
// DELIBERATE — do not "fix" it by giving the worker a storage shim.
//
// SEC-27 made a queued write syncable only by the account that created it.
// Deciding that needs two facts: who owns the row (on the row) and who is
// currently signed in. A service worker can learn the first and **cannot learn
// the second** — the session is an httpOnly cookie, which the worker may send
// via `credentials: 'include'` but can never read, and localStorage is not
// available here at all, so `loadUserCache()` returns null by design.
//
// A worker that cannot tell whose session it is about to write under must not
// write. So the rows wait, and the page drains them on next open, as itself.
// The cost is that a queue left by a closed tab syncs a little later; the thing
// bought is that it can no longer sync as the wrong person.
self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag === 'floral-queue-sync') {
    syncEvent.waitUntil(processQueue());
  }
});
