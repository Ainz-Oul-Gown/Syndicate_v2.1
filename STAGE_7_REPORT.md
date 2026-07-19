# Stage 7 — Registration invites and name history

## Goal
Remove security-sensitive and structured JSON data from `users.status` without reducing registration, invite, profile-name-history, Google, Telegram, email, seed, or Passkey functionality.

## Changes
- Added `registration_invites` with one-time codes, ownership, consumption timestamp, uniqueness, format checks, indexes, and RLS.
- Added `user_name_history` with friendship-aware read access and self-only inserts.
- Migrates valid legacy invite codes and name history from JSON in `users.status`.
- Resets JSON-shaped `users.status` values to the account tier `free`.
- Registration Edge Functions now consume invites atomically from `registration_invites`.
- New accounts use `status = 'free'`.
- Settings UI reads/creates/revokes invite rows instead of rewriting `users.status`.
- Invite generation now uses `crypto.getRandomValues` instead of `Math.random`.
- Display-name history is written to and read from its dedicated table.

## Deployment order
1. Back up the database.
2. Run `supabase/migrations/202607190003_invites_and_name_history.sql`.
3. Deploy all registration-related Edge Functions.
4. Deploy the frontend.

## Functions to redeploy
- auth-custom
- auth-google
- auth-telegram
- auth-telegram-otp
- webauthn-verify-registration

## Rollback note
Do not drop the new tables until the application has been rolled back. A full database backup is the safest rollback mechanism because the migration normalizes JSON-shaped `users.status` values to `free` after copying supported legacy data.
