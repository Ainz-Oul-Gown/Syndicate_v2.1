/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

onBackgroundMessage(getMessaging(firebaseApp), async (payload) => {
  const title = payload.notification?.title || payload.data?.title || 'Syndicate';
  const body = payload.notification?.body || payload.data?.body || 'Новое сообщение';
  const url = payload.data?.url || self.registration.scope;
  await self.registration.showNotification(title, {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: payload.data?.tag || 'syndicate-message',
    data: { url },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => 'focus' in client && client.url.startsWith(self.registration.scope));
    if (existing && 'focus' in existing) {
      await (existing as WindowClient).focus();
      (existing as WindowClient).postMessage({ type: 'SYNDICATE_NOTIFICATION_OPEN', url: targetUrl });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
