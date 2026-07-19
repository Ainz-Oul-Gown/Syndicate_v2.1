# Stage 21 — Telegram Mini App authentication and provider vault recovery

## Critical issue received from the deployed `tg-auth`

The dashboard-only function supplied for review had several account takeover and secret exposure risks:

- printed `JWT_SECRET` to Edge Function logs;
- automatically created a user without an invite code or encryption keys;
- stored a legacy `auth_token` value in `users`;
- issued a 30-day JWT without `session_version` or account-state checks;
- did not reject stale `auth_date` values;
- compared Telegram hashes with a normal string comparison;
- used the nonstandard `MY_SERVICE_ROLE_KEY` secret name;
- did not bind Telegram identity through `user_identities`;
- ignored deactivated/blocked/deleted account rules.

The function has been replaced by repository-backed `supabase/functions/tg-auth/index.ts`.

## Telegram Mini App changes

The new function:

- accepts POST requests only;
- limits request and `initData` size;
- validates Telegram HMAC using `TELEGRAM_BOT_TOKEN`;
- verifies the HMAC through WebCrypto rather than comparing secret strings;
- validates `auth_date` with a configurable maximum age (default 15 minutes);
- validates Telegram user ID, name and username;
- does not log bot tokens, JWT secrets, initData, OTPs or user payloads;
- uses `SUPABASE_SERVICE_ROLE_KEY` consistently;
- binds verified Telegram IDs through `user_identities`;
- restores deactivated accounts through the common authentication flow;
- rejects blocked/deleted accounts;
- issues the common seven-day JWT with `session_version` and `auth_provider`;
- never creates an account during a login-only request;
- returns `registrationRequired` for a verified but unregistered Telegram account.

The frontend now shows a dedicated verified Telegram Mini App registration screen. Registration still requires an invite code and creates RSA/ECDSA keys locally before the account is created.

## Provider vault registration bug fixed

Google and Telegram registration Edge Functions already required `providerVaultSecret`, but the frontend never sent one. As a result, new Google and Telegram registrations would fail when `PROVIDER_VAULT_MASTER_KEY` was correctly configured.

The client now:

- generates a random 256-bit provider recovery secret;
- encrypts the local private-key vault with a key derived from that random secret;
- sends the recovery secret only to the verified provider Edge Function;
- stores the secret server-side only after wrapping it with `PROVIDER_VAULT_MASTER_KEY`;
- uses the returned wrapped recovery secret during future verified Google/Telegram logins;
- retains legacy UID/email/username vault derivation as a fallback for old profiles.

## Telegram OTP bot updated

`supabase/telegram-bot.js` now matches the hardened Edge Function format:

- uses `crypto.randomInt` for the six-digit OTP;
- stores only an HMAC digest of the OTP, never the OTP itself;
- binds the challenge to the real Telegram user ID and username;
- includes issue and expiry timestamps;
- requires `TELEGRAM_OTP_SECRET`;
- rate-limits repeated requests in memory;
- accepts private Telegram chats only;
- does not print OTP values or user identifiers to logs;
- no longer supports an anon-key fallback.

`ALLOW_LEGACY_TELEGRAM_OTP` should be removed or left unset after deploying the new bot.

## CSP and Telegram SDK

The Content Security Policy now explicitly allows the official `https://telegram.org/js/telegram-web-app.js` script. Previously the HTML included that script but CSP blocked it. The app also calls `Telegram.WebApp.ready()` and `expand()` when available.

## Required server secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OTP_SECRET`
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (optional, default `900`)
- `PROVIDER_VAULT_MASTER_KEY` (exactly 32 random bytes encoded as base64)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FIREBASE_API_KEY` for Google authentication

Generate `PROVIDER_VAULT_MASTER_KEY` outside the browser and never put it in a `VITE_` variable. One possible local command is:

```bash
openssl rand -base64 32
```

The Telegram bot and the Telegram OTP Edge Functions must use the same `TELEGRAM_OTP_SECRET`.

## Deployment order

1. Configure/verify the secrets above.
2. Deploy:

```bash
supabase functions deploy tg-auth
supabase functions deploy auth-google
supabase functions deploy auth-telegram
supabase functions deploy auth-telegram-otp
```

3. Restart the updated `supabase/telegram-bot.js` process with the new environment.
4. Deploy the frontend.
5. Test:
   - existing Telegram Mini App login;
   - new Mini App registration with an invite;
   - stale Mini App launch rejection;
   - Google registration and login;
   - Telegram OTP registration and login;
   - deactivated account restoration;
   - blocked account rejection.

No database migration is required for this stage.

## Validation

- Parsed all 44 TS/TSX files with TypeScript 5.8: no syntax failures.
- `node --check supabase/telegram-bot.js`: passed.
- Global `tsc --noEmit` reported only missing dependency declarations because `node_modules` is unavailable; no additional project-local diagnostic was emitted.
- No `console.log(JWT_SECRET)` or legacy `MY_SERVICE_ROLE_KEY` reference remains.
