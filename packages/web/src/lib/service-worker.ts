// Register the VitePWA-generated service worker (autoUpdate strategy).
// We deliberately do NOT force-reload on `controllerchange` or show a
// `confirm()` dialog when a new build is available — both produce a jarring
// "flash + reload" on mobile every time a deploy ships. The new version takes
// effect on the user's next natural cold start, which is fine for an SPA.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol !== "https:") {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service Worker registration failed:", error);
    });
  });
}

export function unregisterServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}

export function isPWAInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}
