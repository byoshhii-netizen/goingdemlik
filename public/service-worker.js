const CACHE_NAME = 'cigcig-app-shell-v6';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/dialogs.css',
  '/theme.js',
  '/homepage-sections.js',
  '/app.js',
  '/dialogs.js',
  '/cigcig.png',
  '/icons/cigcig-192.png',
  '/icons/cigcig-512.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL_URLS.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`Failed to precache ${url}: ${response.status}`);
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('cigcig-app-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch (error) {
      console.warn('CigCig push payload could not be parsed:', error);
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some(client => client.visibilityState === 'visible')) return;

    const title = String(payload.title || 'CigCig').slice(0, 120);
    const link = String(payload.data?.url || '/bildirimler');
    const targetUrl = link.startsWith('/') && !link.startsWith('//')
      ? new URL(link, self.location.origin).href
      : new URL('/bildirimler', self.location.origin).href;
    await self.registration.showNotification(title, {
      body: String(payload.body || 'Yeni bir bildirimin var.').slice(0, 240),
      icon: '/icons/cigcig-192.png',
      badge: '/icons/cigcig-192.png',
      tag: String(payload.tag || 'cigcig-notification'),
      renotify: false,
      data: { url: targetUrl },
      actions: [{ action: 'open', title: 'Görüntüle' }]
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const rawUrl = String(event.notification.data?.url || '/bildirimler');
    const targetUrl = rawUrl.startsWith('/') && !rawUrl.startsWith('//')
      ? new URL(rawUrl, self.location.origin)
      : new URL('/bildirimler', self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ('navigate' in client) await client.navigate(targetUrl.href);
      return client.focus();
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('/', { ignoreSearch: true }))
          || new Response('CigCig çevrimdışı. Bağlantınızı kontrol edip tekrar deneyin.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      event.waitUntil(fetch(request).then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response);
        }
      }).catch(() => {}));
      return cached;
    }

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
