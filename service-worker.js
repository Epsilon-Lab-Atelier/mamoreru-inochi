const VERSION = '0.3.1';
const CACHE_REVISION = 'release-1';
const STATIC_CACHE = `mamoreru-inochi-static-${VERSION}-${CACHE_REVISION}`;
const RUNTIME_CACHE = `mamoreru-inochi-runtime-${VERSION}-${CACHE_REVISION}`;
const MAP_CACHE = `mamoreru-inochi-map-${VERSION}`;
const SCOPE_URL = new URL(self.registration.scope);
const MAP_HOSTS = new Set([
  'cyberjapandata.gsi.go.jp',
  'disaportaldata.gsi.go.jp',
  'www.j-shis.bosai.go.jp'
]);

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
  './assets/screenshots/home-mobile.png',
  './assets/screenshots/family-wide.png',
  './vendor/qrcode.js',
  './src/app.js',
  './src/data.js',
  './src/public-data.js',
  './src/share.js',
  './src/map.js',
  './src/drills.js',
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
          // 利用者が明示的に保存した周辺地図は、アプリ更新だけでは削除しない。
          // 古い静的キャッシュと実行時キャッシュだけを整理する。
          .filter((key) => {
            if (key.startsWith('mamoreru-inochi-map-')) return false;
            return key.startsWith('mamoreru-inochi-') && ![STATIC_CACHE, RUNTIME_CACHE].includes(key);
          })
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (MAP_HOSTS.has(url.hostname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  // 公的なJSON情報への通信は、アプリ画面で個別に許可を得てから直接行う。
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
