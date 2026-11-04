// Cache minimal : l'application s'ouvre même avec une connexion faible.
const CACHE = 'cabine-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co') || u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('api.gouv.fr')) return;
  // réseau d'abord (sans cache du navigateur pour la page et la version), cache en secours
  const fresh = e.request.mode === 'navigate' || u.pathname.endsWith('version.json') || u.pathname.endsWith('/index.html');
  e.respondWith((fresh ? fetch(e.request.url, { cache: 'no-store', credentials: 'same-origin' }) : fetch(e.request)).then(r => { if (r.ok && (u.origin === location.origin || /cdnjs|jsdelivr|unpkg|fonts/.test(u.hostname))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});

// ---- rappels : affichage de la notification et ouverture de la fiche au toucher
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Cabine', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cabine', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: new URL(d.url || '#agenda', self.registration.scope).href },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
