const VERSION = '0.2.0';
const STATIC_CACHE = `mamoreru-inochi-static-${VERSION}`;
const RUNTIME_CACHE = `mamoreru-inochi-runtime-${VERSION}`;
const SCOPE_URL = new URL(self.registration.scope);

const scoped = (path) => new URL(path, SCOPE_URL).toString();

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './version.json',
  './assets/styles.css',
  './assets/og-image.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './src/app.js',
  './src/data.js',
  './src/public-data.js',
  './src/risk-engine.js',
  './src/stockpile-engine.js',
  './src/storage.js',
  './src/crypto.js',
  './src/utils.js'
].map(scoped);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('mamoreru-inochi-') && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 公的データへの通信はアプリ画面で個別に許可を得るため、Service Workerでは横取りしない。
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/service-worker.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response?.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
      return response;
    }
    throw new Error('Navigation response was not usable.');
  } catch {
    return (await caches.match(request))
      || (await caches.match(scoped('./index.html')))
      || (await caches.match(scoped('./offline.html')));
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response?.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || networkPromise || caches.match(scoped('./offline.html'));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
