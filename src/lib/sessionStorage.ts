/**
 * К2: Управление токенами сессии.
 *
 * Access-токен (JWT 30 мин) хранится в памяти (currentToken) + IndexedDB ( resilience при PWA update ).
 * Refresh-токен (7 дней) хранится в localStorage — это компромисс:
 *   - HttpOnly cookie невозможен при cross-origin (Edge Functions на *.supabase.co)
 *   - Refresh-токен ротируется при каждом использовании (одноразовый)
 *   - Кража refresh-токена без knowledge-of-origin бесполезна (CORS)
 *   - При XSS: окно атаки = 30 мин (access) вместо 7 дней
 *
 * IndexedDB используется как бэкап access-токена для восстановления после
 * PWA-обновления (caches.delete + location.replace уничтожают JS-память,
 * но IndexedDB остаётся нетронутым).
 */

import * as idbKeyval from 'idb-keyval';

const ACCESS_TOKEN_IDB_KEY = 'synd_access_token_idb';
const REFRESH_TOKEN_KEY = 'synd_refresh_token'

// --- Access Token (IndexedDB backup) ---

export async function readAccessToken(): Promise<string | null> {
  try {
    const token = await idbKeyval.get<string>(ACCESS_TOKEN_IDB_KEY);
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

export async function writeAccessToken(token: string): Promise<void> {
  try {
    await idbKeyval.set(ACCESS_TOKEN_IDB_KEY, token);
  } catch {
    // silent
  }
}

export async function clearAccessToken(): Promise<void> {
  try {
    await idbKeyval.del(ACCESS_TOKEN_IDB_KEY);
  } catch {
    // silent
  }
}

// --- Refresh Token (localStorage, одноразовый) ---

export function readRefreshToken(): string | null {
    try {
        return localStorage.getItem(REFRESH_TOKEN_KEY)
    } catch {
        return null
    }
}

export function writeRefreshToken(token: string | null): void {
    try {
        if (token) {
            localStorage.setItem(REFRESH_TOKEN_KEY, token)
        } else {
            localStorage.removeItem(REFRESH_TOKEN_KEY)
        }
    } catch {
        // localStorage недоступен (privacy mode) — silent fail
    }
}

// --- Legacy сессия (миграция со старого формата) ---

/**
 * @deprecated Используй readRefreshToken/writeRefreshToken.
 * Оставлен для миграции: удаляет старый synd_token из localStorage.
 */
export function readSessionToken(): string | null {
    return null // access token теперь только в памяти
}

/**
 * @deprecated Access token теперь хранится только в памяти (currentToken).
 * Эта функция ничего не делает.
 */
export function writeSessionToken(_token: string | null): void {
    // Ничего — access token теперь в IndexedDB
    // Очистка legacy-ключа при первом вызове
    try {
        localStorage.removeItem('synd_access_token')
        sessionStorage.removeItem('synd_access_token')
    } catch {
        // silent
    }
}

export async function clearSensitiveBrowserState(): Promise<void> {
    writeRefreshToken(null)

    // Очистка legacy-токена (миграция)
    try {
        localStorage.removeItem('synd_access_token')
        sessionStorage.removeItem('synd_access_token')
    } catch {
        // silent
    }

    // Очистка IndexedDB backup access token
    await clearAccessToken();

    sessionStorage.removeItem('synd_unlock_granted_at')

    localStorage.removeItem('synd_alt_user')
    localStorage.removeItem('synd_my_pubkey_cache')
    localStorage.removeItem('synd_my_pubsign_cache')
}
