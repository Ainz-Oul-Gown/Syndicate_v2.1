/**
 * К2: Supabase клиент с auto-refresh access-токена.
 *
 * Access-токен (30 мин) хранится ТОЛЬКО в памяти.
 * Refresh-токен (7 дней) хранится в localStorage и ротируется при каждом use.
 * При 401: автоматический refresh через auth-refresh endpoint.
 */
import { createClient } from '@supabase/supabase-js';
import { readRefreshToken, writeRefreshToken } from './sessionStorage';
import { createOfflineError, isOnline, reportNetworkFailure, reportNetworkSuccess } from './network';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the environment.'
  );
}

// К2: Access-токен ТОЛЬКО в памяти (не в localStorage)
let currentToken: string | null = null;

export function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export function isSupabaseTokenUsable(token: string | null, clockSkewSeconds = 30) {
  if (!token || !token.startsWith('eyJ')) return false;
  const payload = parseJwt(token);
  const now = Math.floor(Date.now() / 1000);
  return Boolean(payload && Number.isFinite(payload.exp) && payload.exp > now + clockSkewSeconds && (!payload.nbf || payload.nbf <= now + clockSkewSeconds));
}

// --- К2: Auto-refresh mechanism ---

let refreshPromise: Promise<string | null> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * К2: Запрашивает новый access-токен через auth-refresh endpoint.
 * Использует refresh-токен из localStorage (одноразовый — ротация).
 * Возвращает новый access-токен или null при ошибке.
 */
async function performRefresh(): Promise<string | null> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/auth-refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'X-Refresh-Token': refreshToken,
      },
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.token || !data?.refreshToken) return null;

    // Ротация: сохраняем новый refresh-токен, старый отозван сервером
    writeRefreshToken(data.refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

/**
 * К2: Запускает auto-refresh за 5 минут до истечения access-токена.
 */
function scheduleRefresh(token: string) {
  if (refreshTimer) clearTimeout(refreshTimer);

  const payload = parseJwt(token);
  if (!payload?.exp) return;

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = payload.exp - now;
  // Обновляем за 5 минут до истечения (или через 30 секунд, если осталось <5 мин)
  const refreshIn = Math.max((expiresIn - 5 * 60) * 1000, 30_000);

  refreshTimer = setTimeout(async () => {
    const newToken = await performRefresh();
    if (newToken && isSupabaseTokenUsable(newToken)) {
      setSupabaseToken(newToken);
    } else {
      // Refresh failed — session expired
      setSupabaseToken(null);
      window.dispatchEvent(new CustomEvent('syndicate:session-expired'));
    }
  }, refreshIn);
}

/**
 * К2: Обработка 401 — попытка refresh перед очисткой сессии.
 * Возвращает true если refresh удался (нужно повторить запрос).
 */
async function handle401(): Promise<boolean> {
  // Предотвращаем параллельные refresh'и
  if (refreshPromise) return refreshPromise.then(Boolean);

  refreshPromise = performRefresh();
  const newToken = await refreshPromise;
  refreshPromise = null;

  if (newToken && isSupabaseTokenUsable(newToken)) {
    setSupabaseToken(newToken);
    return true;
  }

  return false;
}

// --- Supabase Client ---

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    headers: {
      apikey: SUPABASE_ANON_KEY,
    },
    fetch: (url, options) => {
      const newHeaders = new Headers(options?.headers || {});
      newHeaders.set('apikey', SUPABASE_ANON_KEY);
      if (currentToken) {
        newHeaders.set('Authorization', `Bearer ${currentToken}`);
      } else {
        newHeaders.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
      }
      if (options) {
        options.headers = newHeaders;
      }
      if (!isOnline()) {
        reportNetworkFailure();
        return Promise.reject(createOfflineError());
      }

      return fetch(url, options)
        .then(async (response) => {
          reportNetworkSuccess();

          // К2: При 401 — auto-refresh вместо немедленного logout
          if (response.status === 401 && currentToken) {
            const refreshed = await handle401();
            if (refreshed) {
              // Повторяем оригинальный запрос с новым токеном
              const retryHeaders = new Headers(options?.headers || {});
              retryHeaders.set('apikey', SUPABASE_ANON_KEY);
              retryHeaders.set('Authorization', `Bearer ${currentToken}`);
              return fetch(url, { ...options, headers: retryHeaders });
            }
            // Refresh не удался — сессия истекла
            setSupabaseToken(null);
            window.dispatchEvent(new CustomEvent('syndicate:session-expired'));
          }
          return response;
        })
        .catch((error) => {
          if (!isOnline() || error instanceof TypeError) {
            reportNetworkFailure();
            throw createOfflineError();
          }
          throw error;
        });
    },
  },
  realtime: {
    accessToken: async () => {
      return currentToken || SUPABASE_ANON_KEY;
    },
  },
});

export function setSupabaseToken(token: string | null) {
  currentToken = token;
  if (token) {
    // НЕ сохраняем в localStorage — только в памяти
    scheduleRefresh(token);
    // @ts-ignore - access to internal realtime client to set auth
    if (supabaseClient.realtime && typeof supabaseClient.realtime.setAuth === 'function') {
      // @ts-ignore
      supabaseClient.realtime.setAuth(token);
    }
  } else {
    if (refreshTimer) clearTimeout(refreshTimer);
    // @ts-ignore
    if (supabaseClient.realtime && typeof supabaseClient.realtime.setAuth === 'function') {
      // @ts-ignore
      supabaseClient.realtime.setAuth(SUPABASE_ANON_KEY);
    }
  }
}

export function getSupabaseToken() {
  return currentToken;
}
