import { getMessaging, getToken, isSupported, onMessage, deleteToken } from 'firebase/messaging';
import { app as firebaseApp } from './firebase';
import { supabaseClient } from './supabase';
import { notify } from './notifications';

export type PushState = 'unsupported' | 'default' | 'denied' | 'enabled' | 'error';

const TOKEN_KEY = 'syndicate_fcm_token';
const getDeviceId = () => localStorage.getItem('syndicate_device_id') || 'unknown';

export async function getPushState(): Promise<PushState> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (!(await isSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'default';
  return localStorage.getItem(TOKEN_KEY) ? 'enabled' : 'default';
}

export async function enablePushNotifications(): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) {
    throw new Error('Системные уведомления не поддерживаются этим браузером или WebView');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Разрешение на уведомления не предоставлено');

  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(firebaseApp);
  const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim();
  if (!vapidKey) throw new Error('Не настроен VITE_FIREBASE_VAPID_KEY');

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Не удалось получить токен уведомлений');

  const platform = (window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web');
  const { error } = await supabaseClient.functions.invoke('push-register', {
    body: { token, deviceId: getDeviceId(), platform },
  });
  if (error) throw error;
  localStorage.setItem(TOKEN_KEY, token);
}

export async function disablePushNotifications(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    await supabaseClient.functions.invoke('push-unregister', { body: { token } });
    try {
      if (await isSupported()) await deleteToken(getMessaging(firebaseApp));
    } catch {
      // Server-side deactivation is authoritative.
    }
  }
  localStorage.removeItem(TOKEN_KEY);
}

export async function refreshPushRegistration(): Promise<void> {
  if (Notification.permission !== 'granted' || !localStorage.getItem(TOKEN_KEY)) return;
  try { await enablePushNotifications(); } catch (error) { console.warn('Push refresh failed', error); }
}

export async function listenForForegroundPush(): Promise<() => void> {
  if (!(await isSupported())) return () => {};
  return onMessage(getMessaging(firebaseApp), (payload) => {
    const title = payload.notification?.title || payload.data?.title || 'Syndicate';
    const body = payload.notification?.body || payload.data?.body || 'Новое событие';
    notify(`${title}: ${body}`, 'info', { duration: 6000 });
  });
}
