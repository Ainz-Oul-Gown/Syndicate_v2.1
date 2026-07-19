# Stage 18 — Social and group integrity

## Fixed
- Added `chats.created_by` and backfilled it from the earliest chat member key.
- Only a group creator can rename or delete the group.
- Group creation is now atomic through `create_group_chat`; a chat cannot remain without its creator key.
- Friendship send/accept/reject/remove operations moved to state-aware RPC functions.
- Reverse pending requests automatically become accepted instead of creating a conflicting duplicate.
- Direct browser writes to `friendships` are disabled.
- Currency rates are readable only by their owner and accepted friends.

## Deployment order
1. Back up the database.
2. Apply `202607190009_social_group_integrity.sql`.
3. Deploy the updated frontend.

No Edge Function deployment is required for this stage.
