# Stage 20 — Profile, account state and Passkey security

## Critical issues fixed

### 1. Privilege escalation through `users` updates
The previous `users_update_self` RLS policy allowed an authenticated browser to update every mutable column of its own row. A user could therefore modify `status`, `session_version`, `public_key` and future privileged fields.

The migration now revokes direct browser UPDATE access to `public.users`. Mutations are exposed only through narrow server functions.

### 2. Passkey account takeover
The previous WebAuthn registration functions accepted a client supplied `stableId` and appended a new Passkey to an existing profile without proving that the caller owned that profile.

Existing-profile Passkey registration now requires:
- a valid Syndicate JWT;
- matching UUID and `tg_id`;
- matching `session_version`;
- an active account;
- a one-time five-minute challenge bound to the user, origin and RP ID.

Authentication and registration were also updated to the SimpleWebAuthn v13 credential API.

## Database migration

`supabase/migrations/202607190011_profile_account_security.sql`

It adds:
- `users.account_state` (`active`, `deactivated`, `blocked`, `deleted`);
- `users.deactivated_at`;
- `users.profile_name_changed_at`;
- server-enforced seven-day name-change cooldown;
- atomic invite creation with a three-code concurrency-safe limit;
- one-time initialization for legacy profiles without a public key container;
- reversible account deactivation;
- automatic session/device/invite revocation on deactivation.

New RPC functions:
- `rename_my_profile(new_name)`;
- `initialize_my_public_key(new_public_key)`;
- `create_registration_invite()`;
- `revoke_registration_invite(invite_code)`;
- `deactivate_my_account()`.

## Client changes

- Name changes use `rename_my_profile` instead of direct table updates.
- Invite generation and revocation use atomic RPC functions.
- Legacy key initialization uses a one-time RPC.
- Settings now include reversible account deactivation.
- A verified login by Google, Telegram OTP, seed/email signature, or Passkey automatically restores a deactivated profile.
- Passkey disable now removes the credential from the server, rather than only deleting the local marker.
- `DevicesScreen` now queries users by `tg_id`, not UUID `id`.
- Logged-out profile lookup is routed through `auth-profile`, so strict `users` RLS no longer breaks seed/email/Google recovery.

## Edge Functions added

- `auth-profile`
- `webauthn-remove-credential`

## Edge Functions changed

- `_shared/provider-auth.ts`
- `auth-google`
- `auth-telegram`
- `auth-telegram-otp`
- `auth-seed-challenge`
- `auth-seed-verify`
- `webauthn-generate-registration-options`
- `webauthn-verify-registration`
- `webauthn-generate-authentication-options`
- `webauthn-verify-authentication`

`auth-telegram` and `auth-telegram-otp` now contain the same hardened OTP implementation for compatibility with the existing frontend function name.

## Deployment order

1. Back up the database.
2. Apply `202607190011_profile_account_security.sql`.
3. Deploy every changed/new Edge Function.
4. Deploy the frontend.

Do not deploy the new Edge Functions before the migration because they select `users.account_state`.

## Important external function note

`src/App.tsx` references an Edge Function named `tg-auth`, but its source is not present in the repository. If that function exists only in the Supabase dashboard, it must also be updated to reject `blocked/deleted` accounts and restore `deactivated` accounts before issuing a JWT. Until then, use the repository-backed Telegram OTP flow for deterministic account-state handling.

## Validation

- Parsed all 42 TS/TSX files with TypeScript 5.8: no syntax failures.
- Global `tsc --noEmit` reported only missing package/module declarations because `node_modules` is unavailable in the execution environment.
- No direct client UPDATE remains on `public.users`.
- No direct client INSERT/DELETE remains for invite or name-history tables.
- No legacy SimpleWebAuthn `authenticator`, `credentialID`, or `credentialPublicKey` API remains.
