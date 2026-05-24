// Bump CACHE_NAME whenever the fetch strategy changes so existing clients
// drop their old cache on the next page load. v2 (Task 201) excludes /api/*
// from cache-first; v1 had cached lobby polls indefinitely, freezing the
// ready counter and player list at their first-seen values.
const CACHE_NAME = 'jetlag-v2';

// App shell: index + manifest are cached on install.
// Hashed JS/CSS bundles are cached at runtime on first fetch.
const APP_SHELL = ['/', '/manifest.json'];

/**
 * Returns true for requests that must always hit the network.
 * Dynamic API responses (game state, ready counts, player lists, scores,
 * questions, …) MUST NOT be cached: cache-first behaviour froze the lobby
 * poll on its first response, so the ready counter snapped back to a stale
 * value 3 s after every user action and the Start button never enabled
 * (Task 201).
 */
function isDynamicRequest(request) {
  if (request.method !== 'GET') return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;
  return url.pathname.startsWith('/api/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Navigation requests: network-first, fall back to cached index.html for offline SPA routing.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Dynamic requests (API, non-GET, cross-origin): always go to the network.
  if (isDynamicRequest(event.request)) {
    return;
  }

  // Static assets: cache-first with runtime population.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful same-origin responses.
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
