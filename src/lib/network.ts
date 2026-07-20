import { notify } from './notifications';

export const NETWORK_STATE_EVENT = 'syndicate:network-state';
export const NETWORK_ERROR_MESSAGE = 'Нет подключения к интернету. Проверьте сеть и повторите действие.';

export type NetworkStateDetail = {
  online: boolean;
  source: 'browser' | 'request';
};

let lastReportedOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
let lastNetworkErrorAt = 0;

const emit = (online: boolean, source: NetworkStateDetail['source']) => {
  if (typeof window === 'undefined') return;
  lastReportedOnline = online;
  window.dispatchEvent(new CustomEvent<NetworkStateDetail>(NETWORK_STATE_EVENT, {
    detail: { online, source },
  }));
};

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;

export const reportNetworkSuccess = () => {
  if (!lastReportedOnline) emit(true, 'request');
};

export const reportNetworkFailure = () => {
  emit(false, 'request');
  const now = Date.now();
  if (now - lastNetworkErrorAt > 5000) {
    lastNetworkErrorAt = now;
    notify(NETWORK_ERROR_MESSAGE, 'warning', { duration: 4800 });
  }
};

export const installNetworkMonitoring = () => {
  if (typeof window === 'undefined') return () => {};

  const handleOffline = () => {
    emit(false, 'browser');
    notify('Нет соединения. Локальные данные доступны, сетевые действия временно приостановлены.', 'warning', { duration: 5200 });
  };

  const handleOnline = () => {
    const wasOffline = !lastReportedOnline;
    emit(true, 'browser');
    if (wasOffline) notify('Соединение восстановлено.', 'success');
  };

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  emit(navigator.onLine, 'browser');

  return () => {
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('online', handleOnline);
  };
};

export const createOfflineError = () => new Error(NETWORK_ERROR_MESSAGE);
