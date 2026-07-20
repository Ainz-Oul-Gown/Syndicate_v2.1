import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { AppNotification, NOTIFICATION_EVENT } from '../lib/notifications';

const toneConfig = {
  success: { icon: CheckCircle2, label: 'Успешно', className: 'notification--success' },
  error: { icon: AlertCircle, label: 'Ошибка', className: 'notification--error' },
  warning: { icon: AlertTriangle, label: 'Внимание', className: 'notification--warning' },
  info: { icon: Info, label: 'Информация', className: 'notification--info' },
} as const;

export default function NotificationViewport() {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    const timers = new Map<string, number>();
    const remove = (id: string) => {
      const timer = timers.get(id);
      if (timer) window.clearTimeout(timer);
      timers.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    };

    const handleNotification = (event: Event) => {
      const notification = (event as CustomEvent<AppNotification>).detail;
      if (!notification?.message) return;

      setItems((current) => [...current.slice(-2), notification]);
      timers.set(notification.id, window.setTimeout(() => remove(notification.id), notification.duration));
    };

    window.addEventListener(NOTIFICATION_EVENT, handleNotification);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, handleNotification);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const dismiss = (id: string) => setItems((current) => current.filter((item) => item.id !== id));

  return (
    <div className="notification-viewport" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => {
        const config = toneConfig[item.tone];
        const Icon = config.icon;
        return (
          <div key={item.id} className={`notification-card ${config.className}`} role={item.tone === 'error' ? 'alert' : 'status'}>
            <Icon className="notification-icon" aria-hidden="true" />
            <div className="notification-copy">
              <span className="notification-label">{config.label}</span>
              <p>{item.message}</p>
            </div>
            <button className="notification-close" onClick={() => dismiss(item.id)} aria-label="Закрыть уведомление">
              <X aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
