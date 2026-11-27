const CACHE = 'davetchat-v6';
const LIB = 'davetchat-lib-v1'; // Firebase লাইব্রেরি ও ফন্ট (ঠিকানা না বদলালে একই থাকে)
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'badge-96.png'];
const SDK = ['app', 'auth', 'firestore'].map(n => 'https://www.gstatic.com/firebasejs/10.12.2/firebase-' + n + '.js');
const isLib = u => u.href.startsWith('https://www.gstatic.com/firebasejs/') || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

// রিডাইরেক্ট হওয়া উত্তর সরাসরি পেজ খোলায় ব্যবহার করা যায় না, তাই নতুন করে সাজানো হয়
const clean = res => res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
async function update(cacheName, key, url, opts) {
  const res = await fetch(url, opts);
  if (res.ok) { const c = await caches.open(cacheName); await c.put(key, clean(res.clone())); }
  return clean(res);
}

self.addEventListener('install', e => {
  e.waitUntil(Promise.allSettled([
    ...SHELL.map(u => update(CACHE, u, u, { cache: 'reload' })),
    ...SDK.map(u => update(LIB, u, u, { mode: 'cors', credentials: 'omit' }))
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== LIB).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  if (isLib(u)) { // আগে ফোনের কপি
    e.respondWith(caches.open(LIB).then(c => c.match(r.url)).then(m => m || update(LIB, r.url, r.url, { mode: 'cors', credentials: 'omit' })));
    return;
  }
  if (u.origin !== location.origin) return; // Firebase/TURN সরাসরি নেটওয়ার্কে

  // ফোনের কপি সাথে সাথে দেখাও, পেছনে নতুন সংস্করণ এনে রাখো (পরেরবার খুললে দেখা যাবে)
  const root = new URL('./', self.registration.scope).pathname;
  const isHome = r.mode === 'navigate' && (u.pathname === root || u.pathname === root + 'index.html');
  const key = isHome ? './' : r.url;
  const fresh = update(CACHE, key, r.url, { cache: 'no-cache' });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.open(CACHE).then(c => c.match(key)).then(m => m || fresh.catch(async () => {
    const home = r.mode === 'navigate' && await caches.match('./');
    return home || Response.error();
  })));
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
