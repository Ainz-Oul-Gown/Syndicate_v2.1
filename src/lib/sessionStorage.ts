const TOKEN_KEY = 'synd_token';

export function readSessionToken(): string | null {
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);
  if (sessionToken) return sessionToken;
  const legacy = localStorage.getItem(TOKEN_KEY);
  if (legacy) {
    sessionStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(TOKEN_KEY);
    return legacy;
  }
  return null;
}

export function writeSessionToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearSensitiveBrowserState(): void {
  writeSessionToken(null);
  sessionStorage.removeItem('synd_unlock_granted_at');
  localStorage.removeItem('synd_my_pubkey_cache');
  localStorage.removeItem('synd_my_pubsign_cache');
}
