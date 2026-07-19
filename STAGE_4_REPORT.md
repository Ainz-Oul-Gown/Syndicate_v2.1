# Stage 4 — Seed login challenge-response

## Scope
Only the existing seed-phrase login path was changed. Registration, WebAuthn, Telegram, Google and email login flows remain unchanged for this stage.

## Fixed
- Existing seed accounts no longer request a JWT from `auth-custom` using only a predictable `stableId`.
- Added `auth-seed-challenge`, which creates a random 256-bit, five-minute, purpose-bound challenge.
- Added `auth-seed-verify`, which atomically consumes the challenge, verifies an ECDSA P-256/SHA-256 signature against `users.public_key.legacy.ecdsa`, and only then issues the JWT.
- A challenge cannot be replayed because its database row is deleted before verification and returned only to the first matching request.
- Responses use `Cache-Control: no-store`.

## Deployment
```bash
supabase functions deploy auth-seed-challenge
supabase functions deploy auth-seed-verify
```

The existing `JWT_SECRET`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` function secrets are required.

## Remaining risk
`auth-custom` is still used by Telegram, Google and email login paths and can issue a JWT using only `stableId`. Those paths must be migrated separately to provider-specific proof or signed challenge flows.
