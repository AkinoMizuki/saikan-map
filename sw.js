'use strict';

const APP_VERSION = '0.1.0';
const CACHE_PREFIX = 'domap-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const ASSET_PATHS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './data/catalog.json'
];

function assetUrls() {
  return ASSET_PATHS.map((path) => new URL(path, self.registration.scope).href);
}

async function cacheAssets() {
  const cache = await caches.open(CACHE_NAME);
  const results = [];
  for (const url of assetUrls()) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response.clone());
      results.push({ url, ok: true });
    } catch (error) {
      results.push({ url, ok: false, error: error.message });
    }
  }
  const failed = results.filter((item) => !item.ok);
  if (failed.length) throw new Error(`キャッシュ失敗: ${failed.map((item) => item.url).join(', ')}`);
  return results;
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (cached) {
    if (request.method === 'GET' && request.url.startsWith(self.registration.scope)) {
      fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response);
        }
      }).catch(() => {});
    }
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET' && request.url.startsWith(self.registration.scope)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === 'navigate') {
      const fallback = await caches.match(new URL('./index.html', self.registration.scope).href);
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(cacheFirst(event.request));
});

self.addEventListener('message', (event) => {
  const port = event.ports?.[0];
  if (!port) return;
  if (event.data?.type === 'PRECACHE_ALL') {
    event.waitUntil(cacheAssets()
      .then((results) => port.postMessage({ ok: true, results }))
      .catch((error) => port.postMessage({ ok: false, error: error.message })));
    return;
  }
  if (event.data?.type === 'CLEAR_APP_CACHES') {
    event.waitUntil(caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name))))
      .then(() => port.postMessage({ ok: true }))
      .catch((error) => port.postMessage({ ok: false, error: error.message })));
  }
});
