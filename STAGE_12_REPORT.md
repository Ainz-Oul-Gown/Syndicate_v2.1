# Stage 12 — Query and error hardening

## Changes
- Message history no longer performs an unbounded `select('*')`.
- Initial chat load fetches the newest 200 messages; subsequent sync fetches only records newer than the cached timestamp.
- IndexedDB history remains capped at 500 encrypted messages per chat.
- Message inserts now check and propagate Supabase errors instead of silently succeeding in the UI.
- Broad selects were narrowed in chat friend loading, currency loading, device loading, and semantic search.
- Added a shared Supabase error normalizer for subsequent UI migration.

## Manual checks
1. Open a chat with more than 200 messages and confirm the newest history opens quickly.
2. Send a message while offline and confirm an error is logged rather than silently ignored.
3. Reconnect and confirm Realtime appends the sent message once.
4. Open currencies, devices, friend invite list, and deep search.

## Remaining work
Some legacy screens still use broad selects and browser alerts. They should be migrated incrementally because their returned shapes are inconsistent and changing all of them at once risks regressions.
