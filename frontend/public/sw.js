const CACHE_VERSION = 'v2';
const CACHE_NAME = `sigma-ai-${CACHE_VERSION}`;
const STATIC_CACHE = `sigma-ai-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `sigma-ai-dynamic-${CACHE_VERSION}`;

// Dynamic cache LRU cap — prevents unbounded growth from runtime responses.
const DYNAMIC_CACHE_MAX_ENTRIES = 60;

// Static assets to cache immediately
// NOTE: keep this list to files that ACTUALLY exist in /public, otherwise
// cache.addAll() rejects the whole install (one 404 = whole cache fails).
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// Trim the dynamic cache to a bounded LRU set (oldest entries evicted).
async function trimDynamicCache() {
  const cache = await caches.open(DYNAMIC_CACHE);
  const keys = await cache.keys();
  if (keys.length <= DYNAMIC_CACHE_MAX_ENTRIES) return;
  for (const key of keys.slice(0, keys.length - DYNAMIC_CACHE_MAX_ENTRIES)) {
    await cache.delete(key);
  }
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls and chrome-extension
  if (url.pathname.startsWith('/api') || url.protocol === 'chrome-extension:') return;

  // Network first for navigation requests — users must always get the
  // newest index.html so a deploy is picked up on the next reload.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseClone).then(trimDynamicCache);
          });
          return response;
        })
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Cache-first ONLY for same-origin build outputs (Vite emits
  // content-hashed filenames under /assets/, so a cached entry can never go
  // stale — a new build produces new URLs). Cross-origin media (Supabase
  // avatars, R2 figures, …) must NOT be frozen cache-first and is handled
  // by the network-first branch below.
  if (
    isSameOrigin(url) &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.woff') ||
      url.pathname.endsWith('.ttf') ||
      url.pathname.endsWith('.eot'))
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        });
      })
    );
    return;
  }

  // Network first for everything else (incl. all cross-origin requests)
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(request, responseClone).then(trimDynamicCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Listen for messages from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
