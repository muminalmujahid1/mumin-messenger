const CACHE = 'davetchat-v7';
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
      const msg = { type: act === 'answer' ? 'call-answer' : 'call-decline', callId: (n.data && n.data.callId) || '' };
      if (list.length) { list.forEach(c => c.postMessage(msg)); if (act === 'answer' && 'focus' in list[0]) await list[0].focus(); return; }
      return self.clients.openWindow('./?callaction=' + (act === 'answer' ? 'answer' : 'decline'));
    }
    const chatId = n.data && n.data.chatId;
    for (const c of list) if ('focus' in c) { if (chatId) c.postMessage({ type: 'open-chat', chatId }); await c.focus(); return; }
    return self.clients.openWindow('./');
  })());
});

/* ---------------- ইনকামিং কল পুশ (FCM) ----------------
   সার্ভার শুধু "data" মেসেজ পাঠায়: { type:'call'|'call-cancel'|'call-end', callId, fromName, fromPhone, callType, status, ts } */
const AV_COLORS = ['#e5484d','#8e4ec6','#3e63dd','#0091ff','#12a594','#30a46c','#f76b15','#ab6400','#d6409f','#5c6c7a'];
// অ্যাপের ভেতরের avatarIcon এর মতোই: রঙিন গোল/বর্গ + নামের প্রথম অক্ষর
async function avatarFor(name, phone) {
  try {
    if (typeof OffscreenCanvas === 'undefined') return 'icon-192.png';
    const c = new OffscreenCanvas(192, 192), x = c.getContext('2d');
    const col = AV_COLORS[[...String(phone || name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV_COLORS.length];
    x.fillStyle = col; x.fillRect(0, 0, 192, 192); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 96px "Noto Sans Bengali","Hind Siliguri",system-ui,sans-serif';
    x.fillText([...String(name || '?')][0] || '?', 96, 102);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res('icon-192.png'); r.readAsDataURL(blob); });
  } catch (_) { return 'icon-192.png'; }
}
const closeCallNotifs = async () => (await self.registration.getNotifications({ tag: 'call' })).forEach(n => n.close());

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let p = {}; try { p = e.data ? e.data.json() : {}; } catch (_) {}
    const d = p.data || p;                       // FCM ওয়েব ডেটা মেসেজে মূল তথ্য "data" এর ভেতরে থাকে
    const type = d.type;
    if (type !== 'call' && type !== 'call-cancel' && type !== 'call-end' && type !== 'msg') return;

    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some(w => w.visibilityState === 'visible');

    if (type === 'msg') {                          // নতুন চ্যাট মেসেজ
      if (visible) return;                          // অ্যাপ সামনে খোলা: অ্যাপ নিজেই দেখাবে/শব্দ করবে
      const tag = d.chatId || 'msg', ex = await self.registration.getNotifications({ tag });
      if (ex.some(n => n.body === d.body && Date.now() - (n.timestamp || 0) < 8000)) return;   // অ্যাপের নিজের নোটিফিকেশন আগেই দেখিয়েছে
      await self.registration.showNotification(d.title || 'DavetChat', { body: d.body || '', icon: await avatarFor(d.avatarName || d.title, d.avatarKey),
        badge: 'badge-96.png', tag, renotify: true, silent: false, timestamp: Date.now(), vibrate: [120, 60, 120], data: { id: tag, chatId: d.chatId || '' } });
      return;
    }
    if (type === 'call') {
      if (visible) return;                        // অ্যাপ সামনে খোলা: অ্যাপের নিজের কল স্ক্রিনই দেখাবে
      const ts = +d.ts || 0; if (ts && Date.now() - ts > 60000) return;   // পুরনো কল দেখাবে না
      const nm = d.fromName || 'অজানা', video = d.callType === 'video';
      await self.registration.showNotification('📞 ' + (video ? 'ভিডিও' : 'অডিও') + ' কল', {
        body: nm + ' আপনাকে কল করছে', icon: await avatarFor(nm, d.fromPhone), badge: 'badge-96.png',
        tag: 'call', renotify: true, requireInteraction: true, silent: false, timestamp: Date.now(),
        vibrate: [500, 250, 500, 250, 500, 250, 500, 250, 500],
        data: { id: 'call', callId: d.callId || '' },
        actions: [{ action: 'answer', title: 'ধরুন' }, { action: 'decline', title: 'কাটুন' }]
      });
      return;
    }
    // call-cancel (মিসড/বাতিল) বা call-end (অন্য জায়গায় ধরা/কাটা হয়েছে)
    const cur = (await self.registration.getNotifications({ tag: 'call' }))[0];
    if (cur && cur.data && d.callId && cur.data.callId && cur.data.callId !== d.callId) return; // অন্য কলের Popup ছোঁব না
    if (type === 'call-cancel' && !visible) {
      const nm = d.fromName || 'অজানা';
      await self.registration.showNotification('মিসড কল', { body: nm + ' আপনাকে কল করেছিলেন', icon: await avatarFor(nm, d.fromPhone),
        badge: 'badge-96.png', tag: 'call', silent: true, timestamp: Date.now(), data: { id: 'call', callId: '' } });
    } else if (!visible && !cur) {
      // ব্রাউজার নিয়ম: পুশ এলে কিছু একটা দেখাতেই হয়; তাই নিঃশব্দে দেখিয়ে সাথে সাথে সরাই
      await self.registration.showNotification('DavetChat', { tag: 'call', silent: true, data: { id: 'call', callId: '' } });
      await closeCallNotifs();
    } else if (cur) { await closeCallNotifs(); }
  })());
});
