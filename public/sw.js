/* McPrime Digital — Web Push service worker.
   Receives push payloads from the server (lib/push.ts) and shows a native
   device notification; clicking it focuses or opens the relevant page. */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'McPrime Digital', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'McPrime Digital'
  const options = {
    body: data.body || '',
    icon: data.icon || '/mcprime-logo.jpg',
    badge: '/mcprime-logo.jpg',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.focus()
          if ('navigate' in w && target) {
            try { w.navigate(target) } catch (e) {}
          }
          return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})

// Activate immediately on update.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
