# Stage 3 — Registration invite hardening

## Scope

This stage only hardens registration invite handling. It does not redesign all authentication flows or database policies.

## Fixed

- Removed hard-coded registration bypass codes from the client.
- Removed the UI text that publicly exposed a master code.
- Removed client-side invite lookup and consumption against `public.users.status`.
- Added server-side invite validation and one-time consumption to `auth-custom`.
- Added the same server-side validation to `webauthn-verify-registration`.
- Registration calls now pass the invite code to the Edge Function.
- Added input validation for `stableId`, registration mode, invite length, and required Supabase secrets.
- Invite consumption uses an optimistic compare on the original `status` value, reducing double-use races.

## Important remaining risk

`auth-custom` still issues a JWT for an existing account based only on `stableId`. This is not secure authentication. It must be replaced with proof-of-possession (for example, a signed one-time challenge), or the individual identity provider must be verified server-side before token issuance.

This was intentionally not silently changed because doing so requires coordinated updates to seed, email, Google, Telegram, and device-sync login flows.

## Database observations from the supplied schema

- `debts.creditor_id`, `debts.debtor_id`, `currencies.owner_id`, `device_requests.user_id`, and `user_devices.user_id` have no foreign keys to `users(tg_id)`.
- `device_requests` and `user_devices` can accumulate orphaned rows.
- `friendships` lacks a uniqueness constraint preventing duplicate or reversed duplicate relationships.
- `debts.amount` and `currencies.rub_value` have no positive-value checks.
- `messages.chat_id`, `messages.sender_id`, `chat_keys.chat_id`, and `chat_keys.user_id` are nullable although the records appear meaningless without them.
- Invite data is stored inside JSON serialized into a text column. A dedicated invites table is safer and allows atomic single-use constraints.
- RLS policies were not provided, so table access safety cannot yet be verified.

## Deployment

Deploy both changed Edge Functions:

```bash
supabase functions deploy auth-custom
supabase functions deploy webauthn-verify-registration
```

No SQL migration is required for this stage.
