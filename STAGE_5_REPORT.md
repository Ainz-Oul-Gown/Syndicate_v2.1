# Stage 5 — Provider authentication hardening

## Scope
This stage removes the universal “issue a JWT from stableId” login path while retaining Seed, Email, Google, Telegram and Passkey functionality.

## Changes

### auth-custom
- Login (`isRegister: false`) is rejected unconditionally.
- The function remains available for Seed and Email registration, where an unused invite is required.

### Google
- Added `supabase/functions/auth-google/index.ts`.
- Client sends a fresh Firebase ID Token.
- Edge Function verifies the token through Firebase Identity Toolkit `accounts:lookup`.
- User identity is derived server-side from verified Firebase `localId`.
- Existing legacy Google accounts derived from verified email remain supported for login.
- Registration invite consumption and JWT issuance happen server-side.

### Telegram OTP
- Added `supabase/functions/auth-telegram/index.ts`.
- OTP lookup, expiration validation and one-time deletion moved from the browser to the Edge Function.
- The client can no longer read/delete `auth_challenges` to authenticate itself.
- Login and registration are issued only after server-side OTP verification.

### Email
- Supabase email OTP is still required.
- After OTP verification, login uses the existing ECDSA private key to sign a one-time challenge.
- A stolen or guessed stableId is insufficient to receive a Syndicate JWT.

### Seed and Passkey
- Existing challenge-response Seed login remains unchanged.
- Existing WebAuthn verification remains unchanged.

## Required deployment

```bash
supabase functions deploy auth-custom
supabase functions deploy auth-google
supabase functions deploy auth-telegram
supabase functions deploy auth-seed-challenge
supabase functions deploy auth-seed-verify
```

## Required server secrets

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
FIREBASE_API_KEY
```

`FIREBASE_API_KEY` must be configured as a Supabase Edge Function secret. It is the Firebase Web API key; verification still occurs server-side against Firebase and does not trust client claims.

## Verification status

- Source search confirms there are no remaining client calls to `auth-custom` with `isRegister: false`.
- Client no longer directly queries `auth_challenges` for Telegram OTP authentication.
- TypeScript parser reached the project without reporting syntax errors in changed code, but full type/build verification remains blocked because the archive contains no `node_modules` and dependency installation is unavailable in the execution window.

## Remaining risks for later stages

- Registration still uses deterministic numeric IDs and should eventually be modeled with a dedicated `auth_identities` table.
- Provider metadata is currently embedded in `users.status`; it should move to normalized tables.
- `tg-auth`, QR login and stored long-lived JWT lifecycle require a separate review.
- RLS policies and database constraints are not yet hardened.
