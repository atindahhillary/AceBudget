/**
 * sw.js: minimal offline service worker (Gap G12: weight, bandwidth, access).
 *
 * Cache-first for the known app shell, network-first (falling back to cache)
 * for everything else same-origin. Cross-origin requests are never touched:
 * this app makes zero external network calls by design, and the service
 * worker enforces that at the network layer too.
 */

const CACHE_VERSION = 'acebudget-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/base.css',
  './assets/css/app.css',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
  './src/app.js',
  './src/core/money.js',
  './src/core/dates.js',
  './src/core/store.js',
  './src/data/categories.js',
  './src/engine/analytics.js',
  './src/engine/coach.js',
  './src/engine/debtPlan.js',
  './src/engine/shock.js',
  './src/ui/render.js',
  './src/ui/toast.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Defense in depth: never intercept or cache a cross-origin request.
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  const isShellAsset = APP_SHELL.some((path) => url.pathname.endsWith(path.replace('./', '/')) || url.pathname === path);

  if (isShellAsset) {
    // Cache-first: instant load, refreshed quietly in the background.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Network-first for anything else same-origin, falling back to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
