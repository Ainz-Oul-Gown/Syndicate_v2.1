# Stage 17 — Storage finalization and query-surface hardening

## Changes

- Added an admin-only `finalize_voice_storage_migration()` function.
- The function counts root-level legacy voice objects and refuses to tighten the Storage read policy while any remain.
- Once the count is zero, the temporary root-object read exception is removed.
- Removed authenticated browser access to global Storage migration counts.
- Replaced all remaining application and Edge Function `select('*')` calls with explicit column lists.
- Narrowed pending-device reads to the fields required by the approval UI.
- Narrowed authentication responses to the supported user profile fields, preventing future database columns from being exposed automatically.

## Finalization procedure

Check the migration from SQL Editor:

```sql
select * from public.voice_storage_migration_status;
```

When `legacy_root_objects = 0`, run:

```sql
select * from public.finalize_voice_storage_migration();
```

Expected result:

```text
finalized = true
legacy_root_objects = 0
```

The function is intentionally not executable by `anon` or `authenticated` roles.

## Deployment order

1. Apply all previous migrations through `202607190007`.
2. Deploy the Stage 16 frontend and `voice-legacy-migrate` function.
3. Allow legacy files to migrate.
4. Apply `202607190008_storage_finalize_and_query_hardening.sql`.
5. Check migration status in SQL Editor.
6. Call `finalize_voice_storage_migration()` only when the legacy count is zero.
7. Deploy the Stage 17 frontend/functions.
