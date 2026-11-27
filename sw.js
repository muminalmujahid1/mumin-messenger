const CACHE = 'davetchat-v7';
const LIB = 'davetchat-lib-v1'; // Firebase লাইব্রেরি ও ফন্ট
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'badge-96.png'];
const SDK = ['app', 'auth', 'firestore'].map(n => 'https://www.gstatic.com/firebasejs/10.12.2/firebase-' + n + '.js');
const isLib = u => u.href.startsWith('https://www.gstatic.com/firebasejs/') || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

// Redirect হওয়া Response-কে Cache-এ রাখার উপযোগী করে
const clean = res => res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;

async function update(cacheName, key, url, opts) {
  const res = await fetch(url, opts);
  if (res.ok) {
    const c = await caches.open(cacheName);
    await c.put(key, clean(res.clone()));
  }
  return clean(res);
}

self.addEventListener('install', event => {
  event.waitUntil(Promise.allSettled([
    ...SHELL.map(url => update(CACHE, url, url, { cache: 'reload' })),
    ...SDK.map(url => update(LIB, url, url, { mode: 'cors', credentials: 'omit' }))
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        // শুধু DavetChat-এর পুরোনো Cache মুছবে; একই Origin-এর অন্য অ্যাপের Cache নয়
        keys.filter(key => key.startsWith('davetchat-') && key !== CACHE && key !== LIB)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isLib(url)) {
    event.respondWith(
      caches.open(LIB)
        .then(cache => cache.match(request.url))
        .then(match => match || update(LIB, request.url, request.url, { mode: 'cors', credentials: 'omit' }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // Firebase/TURN সরাসরি নেটওয়ার্কে

  const root = new URL('./', self.registration.scope).pathname;
  const isHome = request.mode === 'navigate' && (url.pathname === root || url.pathname === root + 'index.html');
  const key = isHome ? './' : request.url;
  const fresh = update(CACHE, key, request.url, { cache: 'no-cache' });

  // পুরোনো কপি দ্রুত দেখাও; ব্যাকগ্রাউন্ডে নতুন কপি Cache-এ রাখো
  event.waitUntil(fresh.catch(() => {}));
  event.respondWith(
    caches.open(CACHE)
      .then(cache => cache.match(key))
      .then(match => match || fresh.catch(async () => {
        const home = request.mode === 'navigate' ? await caches.match('./') : null;
        return home || Response.error();
      }))
  );
});

// Firebase Cloud Messaging Web Push
// Incoming payload: type=incoming_call, callId, callerName/fromName, callerPhoto/photo, body (optional).
// Cancellation types: call_cancelled, call_ended, call_answered.
async function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch (_) {
    try {
      return JSON.parse(event.data.text());
    } catch (_) {
      return {};
    }
  }
}

function pushData(payload) {
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : (payload || {});
  return { ...data, notification: payload && payload.notification ? payload.notification : data.notification };
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const payload = await readPushPayload(event);
    const data = pushData(payload);
    const type = String(data.type || data.event || '').toLowerCase();
    const callId = String(data.callId || data.call_id || '');
    const cancelTypes = ['call_cancelled', 'call-cancelled', 'call_ended', 'call-ended', 'call_answered', 'call-answered'];

    if (cancelTypes.includes(type)) {
      const notifications = await self.registration.getNotifications({ tag: 'call' });
      notifications.forEach(notification => {
        if (!callId || !notification.data || !notification.data.callId || notification.data.callId === callId) {
          notification.close();
        }
      });
      return;
    }

    const incomingTypes = ['incoming_call', 'incoming-call', 'call', 'call_incoming'];
    if (!incomingTypes.includes(type)) return;

    // অ্যাপ সামনে থাকলে বিদ্যমান Firestore কল UI-কে জানাও; আলাদা Push popup দেখিও না
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appFocused = windows.some(client => client.visibilityState === 'visible' && client.focused);
    if (appFocused) {
      windows.filter(client => client.visibilityState === 'visible').forEach(client => {
        client.postMessage({
          type: 'incoming-call-push',
          callId,
          from: data.from || data.callerPhone || '',
          callerName: data.callerName || data.fromName || data.name || 'নতুন কল'
        });
      });
      return;
    }

    const callerName = String(data.callerName || data.fromName || data.name || 'অজানা ব্যক্তি');
    const callerPhoto = data.callerPhoto || data.photo || data.avatar || '';
    const title = String((data.notification && data.notification.title) || 'ইনকামিং কল');
    const body = String((data.notification && data.notification.body) || data.body || (callerName + ' আপনাকে কল করছেন'));

    await self.registration.showNotification(title, {
      body,
      icon: callerPhoto || './icon-192.png',
      badge: './badge-96.png',
      tag: 'call',
      renotify: false,
      requireInteraction: true,
      vibrate: [250, 150, 250, 150, 400],
      timestamp: Date.now(),
      actions: [
        { action: 'answer', title: 'ধরুন' },
        { action: 'decline', title: 'কাটুন' }
      ],
      data: { type: 'incoming_call', callId, from: data.from || data.callerPhone || '', callerName }
    });
  })());
});

// Notification-এ চাপ / 'ধরুন' / 'কাটুন'
self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const action = event.action;
  const isCall = notification.data && notification.data.type === 'incoming_call';
  const callId = notification.data && notification.data.callId ? String(notification.data.callId) : '';
  notification.close();

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (isCall && (action === 'answer' || action === 'decline')) {
      const message = { type: action === 'answer' ? 'call-answer' : 'call-decline', callId };
      if (windows.length) {
        for (const client of windows) client.postMessage(message);
        if (action === 'answer' && 'focus' in windows[0]) await windows[0].focus();
        return;
      }

      const query = '?callaction=' + (action === 'answer' ? 'answer' : 'decline') +
        (callId ? '&callid=' + encodeURIComponent(callId) : '');
      return self.clients.openWindow(new URL('./' + query, self.registration.scope).href);
    }

    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    return self.clients.openWindow(new URL('./', self.registration.scope).href);
  })());
});
