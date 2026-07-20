# System push notifications setup

The client supports Firebase Cloud Messaging in browsers, installed PWAs, Trusted Web Activity APKs, and Android wrappers whose WebView exposes standards-compatible Service Workers, Push API, and Notifications.

## 1. Firebase

1. Enable Cloud Messaging in the Firebase project already used by the app.
2. Create a Web Push certificate key pair.
3. Add the public key as `VITE_FIREBASE_VAPID_KEY` in the GitHub Actions/build environment.
4. Create a Firebase service account and store its complete JSON as the Supabase Edge Function secret `FIREBASE_SERVICE_ACCOUNT_JSON`.

## 2. Supabase

Apply migration `202607200002_push_notifications.sql`, then deploy:

- `push-register`
- `push-unregister`
- `push-dispatch`

Set secrets:

```sh
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
supabase secrets set PUSH_WEBHOOK_SECRET='a-long-random-secret'
```

Create a Supabase Database Webhook:

- Table: `public.messages`
- Event: `INSERT`
- URL: `https://<PROJECT_REF>.supabase.co/functions/v1/push-dispatch`
- HTTP header: `x-push-secret: <the same PUSH_WEBHOOK_SECRET>`

Push payloads intentionally contain no plaintext message content because messages are end-to-end encrypted. Notifications only identify the sender/chat and report a new encrypted message.

## 3. APK packaging

For reliable Android background notifications, package the PWA as a Trusted Web Activity (Bubblewrap/PWABuilder) or use an Android wrapper with Firebase Messaging and a JavaScript bridge. A generic WebView wrapper that disables Service Workers/Push API cannot receive web push while closed; that is a platform limitation, not an app setting.
