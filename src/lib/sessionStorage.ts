/**
 * К2: Управление токенами сессии.
 *
 * Access-токен (JWT 30 мин) хранится ТОЛЬКО в памяти (currentToken в supabase.ts).
 * Refresh-токен (7 дней) хранится в localStorage — это компромисс:
 *   - HttpOnly cookie невозможен при cross-origin (Edge Functions на *.supabase.co)
 *   - Refresh-токен ротируется при каждом использовании (одноразовый)
 *   - Кража refresh-токена без knowledge-of-origin бесполезна (CORS)
 *   - При XSS: окно атаки = 30 мин (access) вместо 7 дней
 *
 * localStorage НЕ используется для access-токена (было: synd_token).
 */

const ACCESS_TOKEN_KEY = 'synd_access_token'   // DEPRECATED: не используется, миграция
const REFRESH_TOKEN_KEY = 'synd_refresh_token'

// --- Access Token (только память, НЕ localStorage) ---
// currentToken живёт в supabase.ts. sessionStorage.ts НЕ хранит его.

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
    // Ничего — access token НЕ сохраняется в localStorage
    // Очистка старого ключа при первом вызове
    try {
        localStorage.removeItem(ACCESS_TOKEN_KEY)
        sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    } catch {
        // silent
    }
}

export function clearSensitiveBrowserState(): void {
    writeRefreshToken(null)

    // Очистка legacy-токена (миграция)
    try {
        localStorage.removeItem(ACCESS_TOKEN_KEY)
        sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    } catch {
        // silent
    }

    sessionStorage.removeItem('synd_unlock_granted_at')

    localStorage.removeItem('synd_alt_user')
    localStorage.removeItem('synd_my_pubkey_cache')
    localStorage.removeItem('synd_my_pubsign_cache')
}
