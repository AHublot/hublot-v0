// Fonctionne sans réseau (quai, mer) : l'application est mise en cache à la première visite.
// Change VERSION à chaque mise en ligne pour forcer le rafraîchissement.
const VERSION = 'hublot-v3.1.0';
const SHELL = [
  './', 'index.html', 'styles/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'src/app.js', 'src/util.js', 'src/model.js', 'src/actions.js', 'src/store.js', 'src/demo.js', 'src/icons.js',
  'src/whatsapp.js', 'src/voice.js', 'src/xlsx.js', 'src/report.js', 'src/remote.js', 'src/views/common.js', 'src/views/overview.js', 'src/views/boat.js', 'src/views/pages.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.includes('/api/')) return; // données : jamais en cache
  if (url.origin === location.origin) {
    // réseau d'abord (pour recevoir les mises à jour), cache en secours
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; })));
  }
});
