/* 手机壳的离线缓存：只缓存壳自己（很小）。
 * 里面的完整系统（app/）不缓存 —— 它有几百个文件，缓存逻辑容易把旧版本锁死，
 * 而且这个站本来就是只读影印本，联网打开一次比缓存坏了强。 */
var CACHE = 'feiyu-shell-v1';
var ASSETS = [
  './',
  './index.html',
  './shell.css',
  './shell.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 只接管壳自己的资源；app/ 与 tape 一律走网络
  if (url.pathname.indexOf('/app/') >= 0 || url.pathname.indexOf('/tape/') >= 0) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
