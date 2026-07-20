import { createClient } from '@supabase/supabase-js';
import { readSessionToken, writeSessionToken } from './sessionStorage';
import { createOfflineError, isOnline, reportNetworkFailure, reportNetworkSuccess } from './network';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the environment.'
  );
}

let currentToken = readSessionToken();

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

if (!isSupabaseTokenUsable(currentToken)) {
  writeSessionToken(null);
  currentToken = null;
}

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
        .then((response) => {
          reportNetworkSuccess();
          if (response.status === 401 && currentToken) {
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
    writeSessionToken(token);
    // @ts-ignore - access to internal realtime client to set auth
    if (supabaseClient.realtime && typeof supabaseClient.realtime.setAuth === 'function') {
      // @ts-ignore
      supabaseClient.realtime.setAuth(token);
    }
  } else {
    writeSessionToken(null);
  }
}

export function getSupabaseToken() {
  return currentToken;
}
