/// <reference types="vite-plugin-pwa/react" />

interface Window {
  Telegram?: {
    WebApp?: {
      ready?: () => void;
      expand?: () => void;
      initData: string;
      initDataUnsafe?: {
        receiver?: {
          platform?: string;
        };
      };
      HapticFeedback?: {
        impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        selectionChanged: () => void;
      };
    };
  };
}

interface ImportMeta {
  readonly env: Record<string, string>;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: any) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
