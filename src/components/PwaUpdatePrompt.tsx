import { RefreshCw, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { hapticImpact } from '../lib/haptics';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_COOLDOWN_KEY = 'synd_pwa_last_update';
const UPDATE_COOLDOWN_MS = 30_000; // 30 seconds after applying an update, ignore re-detection

export default function PwaUpdatePrompt() {
  const [isApplying, setIsApplying] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // After applying an update, skip re-checking for a cooldown period.
      // This prevents the infinite loop where the newly-activated SW is
      // immediately detected as "another update" by registration.update().
      const lastUpdate = parseInt(localStorage.getItem(UPDATE_COOLDOWN_KEY) || '0', 10);
      if (Date.now() - lastUpdate < UPDATE_COOLDOWN_MS) {
        console.debug('[PWA] Update check skipped — cooldown active');
        return;
      }

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
    if (!needRefresh) {
      setIsApplying(false);
      setShowModal(false);
    } else {
      setShowModal(true);
    }
  }, [needRefresh]);

  if (!showModal) return null;

  const applyUpdate = () => {
    if (isApplying) return;
    setIsApplying(true);
    hapticImpact('warning');

    // Mark the cooldown so the re-registered SW doesn't trigger needRefresh
    localStorage.setItem(UPDATE_COOLDOWN_KEY, Date.now().toString());
    setNeedRefresh(false);

    // Standard Vite PWA update: skipWaiting → clients.claim → soft reload
    updateServiceWorker(true);
  };

  const dismiss = () => {
    hapticImpact('selection');
    setShowModal(false);
    setNeedRefresh(false);
  };

  return (
    <div className="fixed inset-0 z-[5000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
      <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/90 p-6 rounded-3xl flex flex-col items-center gap-4 max-w-xs w-full relative shadow-2xl">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
          <Download className={`w-8 h-8 text-primary ${isApplying ? 'animate-bounce' : ''}`} />
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h3 className="font-extrabold font-mono tracking-tight text-slate-100 text-base uppercase">
            Доступно обновление
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-[240px]">
            Новая версия приложения готова к установке. Обновление произойдёт без потери данных.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2.5 w-full mt-1">
          <button
            type="button"
            onClick={applyUpdate}
            disabled={isApplying}
            className="w-full bg-primary hover:bg-primary-hover disabled:opacity-60 text-white font-bold font-mono tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] shadow-lg shadow-primary/20"
          >
            {isApplying ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> ОБНОВЛЯЕМ…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" /> Обновить приложение
              </>
            )}
          </button>

          <button
            type="button"
            onClick={dismiss}
            disabled={isApplying}
            className="w-full bg-slate-900/50 hover:bg-slate-800 disabled:opacity-40 text-slate-400 font-bold font-mono tracking-wide py-3 rounded-2xl flex items-center justify-center gap-2 transition border border-slate-800/80"
          >
            <X className="w-4 h-4" /> ОТМЕНИТЬ
          </button>
        </div>
      </div>
    </div>
  );
}
