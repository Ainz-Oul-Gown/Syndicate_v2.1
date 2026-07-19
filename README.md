# Syndicate

React/Vite client deployed to GitHub Pages. Supabase provides the database, Realtime, Storage, and Edge Functions. Firebase Authentication is used for Google sign-in.

## Local development

Prerequisites: Node.js 22 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Fill all `VITE_SUPABASE_*` and `VITE_FIREBASE_*` values in `.env.local` before starting the app. Variables prefixed with `VITE_` are public browser configuration and must never contain `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, bot tokens, or passwords.

## GitHub Pages deployment

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The workflow `.github/workflows/deploy.yml` injects them only during the Vite build. They are browser-visible by design. Security must be enforced with Supabase RLS and correct Firebase authorized domains.

## Server-side secrets 

Configure Edge Function secrets separately; do not add them to GitHub Pages build variables:

```bash
supabase secrets set \
  SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  JWT_SECRET="..."
```

The Telegram bot additionally requires `TELEGRAM_BOT_TOKEN` in its own server environment.

## Checks

```bash
npm run lint
npm run build
```
