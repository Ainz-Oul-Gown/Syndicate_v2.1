# Stage 6 — Database integrity and RLS

## Scope

This stage adds a deployable SQL migration for the supplied schema and makes one
client compatibility change. It does not delete user content.

## Added

- `supabase/migrations/202607190002_integrity_and_rls.sql`
- `supabase/migrations/STAGE_6_PREFLIGHT.sql`
- foreign keys for debts, currencies, device requests and devices (`NOT VALID`)
- positive-value and non-empty checks (`NOT VALID`)
- indexes for friendships, chats, messages, debts, currencies and devices
- conditional uniqueness indexes that are skipped when legacy duplicates exist
- `current_tg_id()` helper based on the signed JWT claim
- explicit RLS policies for users, friendships, chats, chat keys, messages,
  debts, currencies and device records
- complete browser lockout for `auth_challenges`

## Compatibility fix

Private-chat creation now inserts the current user's `chat_keys` row before the
friend's row. The RLS policy permits an authenticated user to bootstrap their own
membership, then add another participant.

## Security cleanup

The unused `users.auth_token` values are nulled by the migration and new
registration paths no longer create them.

## Important follow-up

`users.status` still stores invitation codes and profile metadata together. RLS
cannot hide individual columns, so the next database stage should migrate invites
to a dedicated server-only table and leave only non-sensitive profile metadata in
`status`.

## Deployment

1. Back up the database.
2. Run `STAGE_6_PREFLIGHT.sql` in Supabase SQL Editor and inspect non-empty results.
3. Apply migrations in order with Supabase CLI, or run
   `202607190002_integrity_and_rls.sql` in SQL Editor.
4. Test login, friend request, private/group/saved chats, messages, debts,
   currencies and device linking.

Foreign keys/checks marked `NOT VALID` protect new writes immediately. Validate
legacy rows after preflight issues are cleaned with `ALTER TABLE ... VALIDATE
CONSTRAINT ...`.
