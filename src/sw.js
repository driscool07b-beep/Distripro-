import { precacheAndRoute } from 'workbox-precaching'

// Pré-cache des fichiers de l'app (JS/CSS/HTML/icônes) pour qu'elle
// s'ouvre hors-ligne — jamais les appels réseau vers Supabase, qui
// passent toujours par la file d'attente de synchronisation (voir
// src/lib/offline.js), pas par un cache HTTP générique.
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Réception d'une notification push envoyée par l'Edge Function
// 'envoyer-notification-push' — s'affiche même si l'app est fermée.
self.addEventListener('push', (event) => {
  let donnees = {}
  try {
    donnees = event.data ? event.data.json() : {}
  } catch {
    donnees = { title: 'DistribPro', body: event.data ? event.data.text() : '' }
  }

  const titre = donnees.title || 'DistribPro'
  const options = {
    body: donnees.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: donnees.url || '/' },
    vibrate: [100, 50, 100],
  }

  event.waitUntil(self.registration.showNotification(titre, options))
})

// Clic sur la notification : ramène au premier onglet déjà ouvert de
// l'app si possible, sinon en ouvre un nouveau sur la bonne page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
