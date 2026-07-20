import { useEffect, useState } from 'react';
import { CloudOff, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

export type StartupState = 'loading' | 'offline' | 'error';

type StartupScreenProps = {
  state: StartupState;
  message: string;
  onRetry: () => void;
};

const steps = ['Проверяем сессию', 'Загружаем ключи', 'Подключаемся'];

export default function StartupScreen({ state, message, onRetry }: StartupScreenProps) {
  const [showRetry, setShowRetry] = useState(state !== 'loading');

  useEffect(() => {
    if (state !== 'loading') {
      setShowRetry(true);
      return;
    }

    setShowRetry(false);
    const timer = window.setTimeout(() => setShowRetry(true), 9000);
    return () => window.clearTimeout(timer);
  }, [state, message]);

  const activeStep = Math.max(0, steps.findIndex((step) => message.toLowerCase().includes(step.toLowerCase().split(' ')[0])));
  const isOffline = state === 'offline';
  const isError = state === 'error';

  return (
    <div className="startup-screen" role="status" aria-live="polite">
      <div className={`startup-icon ${isOffline || isError ? 'startup-icon-warning' : ''}`}>
        {isOffline ? <CloudOff aria-hidden="true" /> : isError ? <RefreshCw aria-hidden="true" /> : <Loader2 className="animate-spin" aria-hidden="true" />}
      </div>

      <h1>{isOffline ? 'Ожидаем подключение' : isError ? 'Не удалось запустить приложение' : 'Запускаем Синдикат'}</h1>
      <p>{message}</p>

      {!isOffline && !isError && (
        <div className="startup-steps" aria-label="Этапы запуска">
          {steps.map((step, index) => (
            <div key={step} className={`startup-step ${index < activeStep ? 'done' : ''} ${index === activeStep ? 'active' : ''}`}>
              <span>{index < activeStep ? <ShieldCheck aria-hidden="true" /> : index + 1}</span>
              <small>{step}</small>
            </div>
          ))}
        </div>
      )}

      {showRetry && (
        <button type="button" className="startup-retry" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Повторить
        </button>
      )}

      {isOffline && <small className="startup-hint">Локальные данные не удалены. Запуск продолжится после восстановления сети.</small>}
    </div>
  );
}
