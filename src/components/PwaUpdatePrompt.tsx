import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export default function PwaUpdatePrompt() {
  const [isApplying, setIsApplying] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        if (navigator.onLine) {
          registration.update().catch((error) => {
            console.debug('Service worker update check failed:', error);
          });
        }
      };

      const intervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      };

      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // The registration callback has no lifecycle cleanup hook, so clean up when the page unloads.
      window.addEventListener(
        'pagehide',
        () => {
          window.clearInterval(intervalId);
          window.removeEventListener('online', checkForUpdate);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        },
        { once: true },
      );
    },
    onRegisterError(error) {
      console.error('Service worker registration failed:', error);
    },
  });

  useEffect(() => {
    if (!needRefresh) setIsApplying(false);
  }, [needRefresh]);

  if (!needRefresh) return null;

  const applyUpdate = async () => {
    if (isApplying) return;
    setIsApplying(true);

    try {
      await updateServiceWorker(true);
    } catch (error) {
      console.error('Failed to activate the app update:', error);
      setIsApplying(false);
      alert('Не удалось применить обновление. Проверьте соединение и попробуйте ещё раз.');
    }
  };

  return (
    <section className="pwa-update" role="status" aria-live="polite" aria-label="Доступно обновление приложения">
      <RefreshCw className={isApplying ? 'pwa-update__icon pwa-update__icon--spinning' : 'pwa-update__icon'} aria-hidden="true" />
      <div className="pwa-update__copy">
        <strong>Доступно обновление</strong>
        <small>Новая версия готова к установке</small>
      </div>
      <button
        type="button"
        className="pwa-update__action"
        onClick={applyUpdate}
        disabled={isApplying}
      >
        {isApplying ? 'Обновляем…' : 'Обновить'}
      </button>
      <button
        type="button"
        className="pwa-update__dismiss"
        aria-label="Скрыть уведомление об обновлении"
        onClick={() => setNeedRefresh(false)}
        disabled={isApplying}
      >
        <X aria-hidden="true" />
      </button>
    </section>
  );
}
