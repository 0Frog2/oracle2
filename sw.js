/* Oracle 2 service worker — offline use, updates, background reminders.
   Bump VERSION on every release: installed copies pick it up on their next open. */
const VERSION = '2.1.0';
const CACHE = 'oracle2-' + VERSION;
const ASSETS = ['./', './index.html', './style.css', './app.js', './reminders.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
importScripts('./reminders.js');

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // GitHub sync etc. goes straight to the network
  if (req.mode === 'navigate') { // the app shell, ignoring ?share=… parameters
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req)));
});

// ---- background reminders (Android/desktop Chrome & Edge with periodic sync; others check on open)
function idbGet(key) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('oracle2', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const t = o.result.transaction('kv', 'readonly').objectStore('kv').get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); };
  });
}
function idbSet(key, val) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('oracle2', 1);
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const t = o.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); };
  });
}
async function backgroundReminders() {
  const D = await idbGet('data'); if (!D) return;
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sent = (await idbGet('notified')) || {};
  for (const r of self.computeReminders(D, today)) {
    if (sent[r.key]) continue;
    sent[r.key] = today;
    await self.registration.showNotification(r.title, {body: r.body, tag: r.key, icon: './icon-192.png', badge: './icon-192.png'});
  }
  await idbSet('notified', sent);
}
self.addEventListener('periodicsync', e => { if (e.tag === 'oracle-reminders') e.waitUntil(backgroundReminders()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window'}).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
