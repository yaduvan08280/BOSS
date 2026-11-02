/* Loaded into the generated service worker (vite.config.ts → workbox.importScripts). */
self.addEventListener('push', (event) => {
  let data = { title: 'MONO', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ('focus' in w) return w.navigate(url).then((c) => c && c.focus());
      return self.clients.openWindow(url);
    }),
  );
});
