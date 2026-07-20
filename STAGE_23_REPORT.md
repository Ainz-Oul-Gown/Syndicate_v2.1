# Stage 23 — Network and offline UX

## Changes
- Added a persistent offline status banner with safe-area support.
- Added browser online/offline monitoring for regular browser, installed PWA, Telegram WebView and future PWA-to-APK wrappers.
- Added a central Supabase fetch guard so server-dependent actions fail immediately with a readable message while offline.
- Kept local UI and locally cached data available; no global screen lock was introduced.
- Added deduplication for repeated network-error notifications.
- Connectivity state is restored automatically after the browser reports online or after a successful server response.

## Verification
- `npm run lint` passed.
- Production `npm run build` passed.
- PWA service worker and precache were regenerated.
