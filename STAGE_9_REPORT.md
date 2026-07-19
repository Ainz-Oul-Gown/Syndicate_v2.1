# Stage 9 — Session lifecycle and revocation

## Changes

- Added `users.session_version` and a positive-value constraint.
- `current_tg_id()` now validates `session_version` and blocks users with status `blocked`.
- Every new Syndicate JWT includes `session_version`.
- Token lifetime reduced from 30 days to 7 days.
- Added `auth-revoke-sessions`; it atomically increments the user's session version.
- Panic wipe invokes remote revocation before deleting local state.
- The browser rejects malformed, expired, and not-yet-valid JWTs before using them.
- A 401 response clears the local token and returns the application to authentication.

## Deployment order

1. Apply `supabase/migrations/202607190005_session_revocation.sql`.
2. Deploy all JWT-issuing functions and `auth-revoke-sessions`.
3. Deploy the frontend.

The migration deliberately invalidates old tokens that do not contain `session_version`; users must sign in again once after deployment.
