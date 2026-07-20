# Stage 25 — Controlled PWA updates

## UX change

- Added a persistent, non-blocking “Доступно обновление” banner when a new service worker is ready.
- The user decides when to activate and reload the app, preventing surprise reloads during chats or key operations.
- Added an explicit loading state while the update is being applied.
- The prompt can be dismissed for the current page session.

## PWA / GitHub Pages / APK compatibility

- Switched `vite-plugin-pwa` from `autoUpdate` to `prompt` registration.
- Disabled automatic `skipWaiting`; activation happens only after the user presses “Обновить”.
- Kept `clientsClaim` and outdated-cache cleanup.
- Added update checks when the app returns to the foreground, comes online, and once per hour.
- Uses standard Service Worker APIs, so it remains compatible with GitHub Pages, installed PWAs, and WebView-based PWA-to-APK wrappers that expose service workers.

## Verification

Run:

```bash
npm ci
npm run check
```
