# Security and code review

## Fixed in this archive

1. **Biometric authentication bypass (critical).** `PinScreen` previously called `onSuccess()` after a delay when the biometric setting was enabled but no local Passkey credential existed. The fallback now disables the stale setting and fails closed.
2. **Leaked Telegram bot token (critical).** Removed the hard-coded token. The bot now requires `TELEGRAM_BOT_TOKEN` from its server environment. Rotate the exposed token through BotFather immediately; removing it from source does not invalidate it.
3. **Insecure OTP randomness (high).** Telegram OTP generation now uses `crypto.randomInt` rather than `Math.random`.
4. **Hard-coded deployment configuration (medium).** The client and diagnostic script now require explicit Supabase environment variables instead of silently connecting to the embedded project.
5. **Server secret separation (high).** The Telegram bot now requires `SUPABASE_SERVICE_ROLE_KEY`; it no longer falls back to an anon key.

## Blocking issue requiring an authentication redesign

`supabase/functions/auth-custom/index.ts` issues a 30-day authenticated JWT when a caller supplies a `stableId`. The function does not require a verified OTP, password proof, OAuth assertion, seed signature, or verified WebAuthn result. Anyone who learns or derives another user's stable ID can request a token for that account.

Do not deploy this function as-is. Each login method must produce a short-lived, one-time server-side challenge/proof. `auth-custom` must consume and verify that proof atomically before issuing a JWT. Registration and invite consumption must also be performed server-side in the same transaction or protected workflow; client-side checks are bypassable.

## Additional high-priority findings

- Telegram OTP challenges are read and verified by browser code. OTP verification and deletion must occur in a server/Edge Function with rate limiting and atomic consume semantics.
- Public-key records and account profile queries rely heavily on database RLS. Review every table policy, especially `users`, `auth_challenges`, messages, invites, and device keys.
- PIN hashes use a global static salt and are stored beside the attempt counter in `localStorage`. Use a per-install random salt, constant-time comparison, and understand that client-side rate limiting can be reset by clearing storage.
- Private encryption/signing keys stored in IndexedDB are extractable or accessible to any successful same-origin XSS. Enforce a strict CSP, avoid third-party runtime content, and consider wrapping keys with a credential-bound key.
- The project has no automated test suite and several UI files exceed 1,000–2,600 lines, making regressions likely. Split authentication and chat logic into testable modules.

## Verification limitations

Dependency installation did not complete in the review environment, so a full TypeScript and Vite build could not be executed. The archive should be verified locally with:

```bash
npm ci
npm run lint
npm run build
```

## Stage 20 update

Closed two critical account-control issues:

1. Browser users could update privileged columns in their own `users` row through an overly broad RLS UPDATE policy.
2. Existing WebAuthn profiles could receive an attacker-controlled Passkey because registration trusted a client supplied `stableId` without validating the current Syndicate session.

Profile, invite, public-key initialization and account deactivation mutations are now narrow RPC/server operations. WebAuthn challenges are single-use, expire after five minutes, are bound to origin/RP/user, and existing-account credential registration requires a matching non-revoked JWT.

## Stage 21 update

The external `tg-auth` function was added to the repository and replaced completely. Telegram Mini App data is now HMAC-validated, time-limited, identity-bound, invite-gated for registration, and issued through the common revocable seven-day JWT flow. Secret logging, automatic keyless registration and legacy `auth_token` creation were removed.

Google and Telegram provider registration now actually supplies the random provider-vault recovery secret expected by the Edge Functions. The Telegram OTP bot was upgraded to the HMAC challenge format and no longer stores or logs plaintext OTP values.
