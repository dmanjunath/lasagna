const CACHE_NAME = 'lasagnafi-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/index.css',
  '/src/components/layout/shell.tsx',
  '/src/components/layout/mobile-nav.tsx',
  '/src/components/layout/mobile-tab-bar.tsx',
  '/src/pages/Dashboard.tsx',
  '/src/pages/Login.tsx',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Cache installation failed:', error);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              })
              .catch((error) => {
                console.error('Cache put failed:', error);
              });
            return response;
          })
          .catch((error) => {
            console.error('Fetch failed:', error);
            // Return a basic offline page for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html') || new Response('Offline');
            }
            throw error;
          });
      })
      .catch((error) => {
        console.error('Cache match failed:', error);
        throw error;
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      })
      .catch((error) => {
        console.error('Cache activation failed:', error);
      })
  );
  self.clients.claim();
});