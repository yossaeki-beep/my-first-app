/* 画面のファイルだけをキャッシュする。保有データは localStorage 側。 */
const CACHE = 'portfolio-v4';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/store.js',
  'js/calc.js',
  'js/csv.js',
  'js/prices.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* オンラインなら常に最新を使う。オフラインのときだけキャッシュを返す。 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
