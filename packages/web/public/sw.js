// Self-destroying service worker.
//
// The PWA was removed: its worker intercepted every navigation and hung for
// ~10s on iOS Safari (worker cold-start on each open), white-screening the app
// on mobile. Browsers that already registered a worker re-fetch this file as
// an update; it unregisters itself and clears its caches so those devices get
// cleaned up. New visitors never register a worker.
//
// Safe to delete this file once existing installs have updated (a few weeks).
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});
