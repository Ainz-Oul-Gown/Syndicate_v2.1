export type NotificationTone = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: string;
  message: string;
  tone: NotificationTone;
  duration: number;
}

export const NOTIFICATION_EVENT = 'syndicate:notification';

const inferTone = (message: string): NotificationTone => {
  const normalized = message.toLocaleLowerCase('ru-RU');
  if (/ошиб|не удалось|отклон|удален|удалён|завершен|завершён|не зарегистрирован|нет ключа/.test(normalized)) return 'error';
  if (/введите|сначала|уже|пожалуйста|корректн/.test(normalized)) return 'warning';
  if (/успеш|отправлен|скопирован|создан|вступили|добавлен/.test(normalized)) return 'success';
  return 'info';
};

export const notify = (
  message: unknown,
  tone?: NotificationTone,
  options: { duration?: number } = {},
) => {
  const text = String(message ?? '').trim();
  if (!text || typeof window === 'undefined') return;

  const notification: AppNotification = {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message: text,
    tone: tone ?? inferTone(text),
    duration: options.duration ?? (tone === 'error' || inferTone(text) === 'error' ? 5200 : 3600),
  };

  window.dispatchEvent(new CustomEvent<AppNotification>(NOTIFICATION_EVENT, { detail: notification }));
};

export const installAlertNotificationBridge = () => {
  if (typeof window === 'undefined') return;
  window.alert = (message?: unknown) => notify(message);
};
