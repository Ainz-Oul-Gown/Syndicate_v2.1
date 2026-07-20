# Stage 33 — System push notifications

Implemented Firebase Cloud Messaging for installed PWA and compatible Android packages.

## Client
- Permission and enable/disable control in Settings.
- FCM token registration per user/device through authenticated Supabase Edge Functions.
- Foreground notifications use the existing in-app notification system.
- Background notifications are handled by the bundled custom service worker.
- Clicking a notification focuses or opens the app.
- No decrypted message text is placed in push payloads.

## Backend
- Added private `push_subscriptions` table.
- Added `push-register`, `push-unregister`, and webhook-only `push-dispatch` Edge Functions.
- `push-dispatch` resolves chat recipients server-side and sends data-only FCM notifications.
- Invalid subscriptions are deactivated.

## Deployment
See `PUSH_NOTIFICATIONS_SETUP.md`. A Firebase service account, VAPID public key, Edge Function secrets, migration, function deployment, and a Supabase Database Webhook are required.

## Android packaging
Recommended: Trusted Web Activity through PWABuilder/Bubblewrap. Generic WebView wrappers must explicitly support Service Workers, Push API, and Notifications or provide a native FCM bridge.

## Verification
- `tsc --noEmit`: passed
- `vite build`: passed
- custom injectManifest service worker: built successfully
