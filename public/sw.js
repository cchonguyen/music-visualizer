/* Music Visualizer service worker (Slice 21.10).
 * Caches the app shell and hashed build assets (which include the builtin presets).
 * Never caches /admin routes, non-GET requests, or cross-origin requests.
 * Bump CACHE_VERSION when the shell strategy changes; old caches are removed on activate. */
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'mv-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_PATHS = ['/', '/index.html', '/manifest.webmanifest'];
const SHELL_KEY = '/index.html';

function isAdminPath(pathname) {
  return pathname.startsWith('/admin');
}

function isCacheFirstPath(pathname) {
  return pathname.startsWith('/assets/') || SHELL_PATHS.includes(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_PATHS.map((path) =>
          fetch(path, { cache: 'reload' })
            .then((res) => (res.ok && res.type === 'basic' ? cache.put(path, res) : undefined))
            .catch(() => undefined),
        ),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, key) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    cache.put(key, res.clone()).catch(() => undefined);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      cache.put(SHELL_KEY, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (err) {
    const fallback = await cache.match(SHELL_KEY);
    if (fallback) return fallback;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isAdminPath(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isCacheFirstPath(url.pathname)) {
    event.respondWith(cacheFirst(request, url.pathname));
  }
});
