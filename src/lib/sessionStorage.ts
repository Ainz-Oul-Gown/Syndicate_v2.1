const TOKEN_KEY = 'synd_token';

export function readSessionToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function writeSessionToken(token: string | null): void {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }

    // ”дал€ем старую временную копию после миграции.
    sessionStorage.removeItem(TOKEN_KEY);
}

export function clearSensitiveBrowserState(): void {
    writeSessionToken(null);

    sessionStorage.removeItem('synd_unlock_granted_at');

    localStorage.removeItem('synd_alt_user');
    localStorage.removeItem('synd_my_pubkey_cache');
    localStorage.removeItem('synd_my_pubsign_cache');
}