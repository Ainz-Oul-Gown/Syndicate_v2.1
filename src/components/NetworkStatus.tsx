import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { NETWORK_STATE_EVENT, NetworkStateDetail, installNetworkMonitoring } from '../lib/network';

export default function NetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<NetworkStateDetail>).detail;
      if (typeof detail?.online === 'boolean') setOnline(detail.online);
    };

    window.addEventListener(NETWORK_STATE_EVENT, handleState);
    const cleanup = installNetworkMonitoring();
    return () => {
      window.removeEventListener(NETWORK_STATE_EVENT, handleState);
      cleanup();
    };
  }, []);

  if (online) return null;

  return (
    <div className="network-status" role="status" aria-live="polite">
      <CloudOff aria-hidden="true" />
      <span><strong>Нет соединения</strong><small>Локальные данные остаются доступны</small></span>
    </div>
  );
}
