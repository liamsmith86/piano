/// <reference lib="webworker" />

const CACHE_NAME = 'player-v5';
const SAMPLE_CACHE = 'player-samples-v1';

// Replaced with the hashed entry JS/CSS by the production build plugin.
const BUILD_ASSETS = [];

// App shell files to precache (updated on each deploy)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Salamander piano sample files to cache on first use
const SAMPLE_HOST = 'tonejs.github.io';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...BUILD_ASSETS]))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== SAMPLE_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Cache-first for Salamander piano samples (large, static files)
  if (url.hostname === SAMPLE_HOST && url.pathname.includes('/audio/salamander/')) {
    event.respondWith(
      caches.open(SAMPLE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone()).catch(() => {});
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Build assets are content-hashed and immutable. Cache-first avoids a
  // network round trip on every launch and is reliable in offline mode.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone()).catch(() => {});
        return response;
      })
    );
    return;
  }

  // Network-first keeps edited scores fresh while retaining offline access.
  if (url.origin === self.location.origin &&
      url.pathname.startsWith('/songs/') &&
      /\.(mxl|musicxml|xml)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(async () => (await cache.match(event.request)) ?? Response.error())
      )
    );
    return;
  }

  // Network-first for app shell (HTML, JS, CSS) — use cache as fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            // Update cache with fresh response
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            return response;
          }
          // Server error (5xx/4xx) — try cached version before returning error
          return caches.match(event.request).then((cached) => cached || response);
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return (await caches.match('/index.html')) ?? Response.error();
          }
          return Response.error();
        })
    );
    return;
  }

  // All other requests: network only
  event.respondWith(fetch(event.request));
});
