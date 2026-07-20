# Stage 24 — Loading states for key actions

## UX changes

- Friend request submission now keeps the modal stable, disables repeated input, and shows `ОТПРАВЛЯЕМ…` with a spinner.
- Group creation now disables duplicate submissions and modal closing, shows `Создаём…`, and restores controls after success or failure.
- Incoming friend request actions now show a spinner on the active request and temporarily disable competing accept/reject actions.
- Failures in group creation and friend-request processing are surfaced through the existing in-app notification system.
- Buttons include disabled states and accessible labels suitable for browser, standalone PWA, WebView, and future PWA-to-APK packaging.

## Verification

- `npx tsc --noEmit` passed.
- `npm run build` passed.
- PWA service worker and precache were regenerated.
