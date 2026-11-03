// Cache minimal : l'application s'ouvre même avec une connexion faible.
const CACHE = 'cabine-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co') || u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('api.gouv.fr')) return;
  // réseau d'abord, cache en secours
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.origin === location.origin || /cdnjs|jsdelivr|unpkg|fonts/.test(u.hostname))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
