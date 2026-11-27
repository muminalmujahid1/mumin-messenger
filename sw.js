const CACHE = 'mumin-messenger-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // Firebase/Cloudinary সরাসরি নেটওয়ার্কে
  e.respondWith(
    fetch(r).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const act = e.action;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const msg = act === 'decline' ? { type: 'call-decline' } : act === 'answer' ? { type: 'call-answer' } : null;
    if (list.length) {
      const c = list[0];
      if (act !== 'decline' && 'focus' in c) { try { await c.focus(); } catch (err) {} }
      if (msg) c.postMessage(msg);
      return;
    }
    if (act !== 'decline') return self.clients.openWindow('./');
  }));
});
