/* オフラインでも打刻できるようにアプリ本体をキャッシュする。
   打刻データ自体は localStorage 側にあり、通信は一切発生しない。 */
const CACHE = 'timecard-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/store.js',
  'js/calc.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
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

/* キャッシュを即返しつつ裏で更新。オフラインでも起動し、
   オンラインなら次回起動時に最新版になる。 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
