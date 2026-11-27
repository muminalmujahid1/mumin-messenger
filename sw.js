const CACHE = 'mumin-messenger-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // Firebase/TURN সরাসরি নেটওয়ার্কে
  e.respondWith(
    fetch(r).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});

// নোটিফিকেশনে চাপ / "ধরুন" / "কাটুন"
self.addEventListener('notificationclick', e => {
  const n = e.notification, act = e.action, isCall = n.tag === 'call';
  n.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (isCall && (act === 'answer' || act === 'decline')) {
      const msg = { type: act === 'answer' ? 'call-answer' : 'call-decline' };
      if (list.length) { list.forEach(c => c.postMessage(msg)); if (act === 'answer' && 'focus' in list[0]) await list[0].focus(); return; }
      return self.clients.openWindow('./?callaction=' + (act === 'answer' ? 'answer' : 'decline'));
    }
    for (const c of list) if ('focus' in c) { await c.focus(); return; }
    return self.clients.openWindow('./');
  })());
});
