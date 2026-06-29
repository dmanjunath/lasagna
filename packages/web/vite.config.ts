import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // DISABLED: the service worker's NavigationRoute intercepted every
      // navigation and hung for ~10s on iOS Safari (worker cold-start on each
      // open), so app.lasagnafi.com showed a white screen on mobile while the
      // static landing page (no SW) loaded instantly. `selfDestroying` ships a
      // worker that unregisters itself and clears its caches on next visit,
      // cleaning up the buggy worker already installed on users' devices.
      selfDestroying: true,
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      workbox: {
        // Precache only the shell — HTML, top-level CSS, manifest, favicon.
        // The big lazy chunks (charts, page bundles, vega-lite, etc.) were
        // pulling ~2.5MB of network in parallel with first-visit page load,
        // which on mobile pushed time-to-content past 6s. Let them be
        // network-fetched on demand and runtime-cached on use.
        globPatterns: ['index.html', 'assets/index-*.css', '*.svg', 'manifest.json'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.plaid\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'plaid-sdk',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      manifest: {
        name: 'LasagnaFi',
        short_name: 'LasagnaFi',
        description: 'Personal finance, layered.',
        theme_color: '#1F1A16',
        background_color: '#FBF6EC',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
