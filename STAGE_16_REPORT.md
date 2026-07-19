# Stage 16 — message deletion and legacy voice migration

## Changes

- Added `delete_own_message(uuid)` RPC. It deletes only the caller's message. Related `message_attachments` rows are removed by cascade and their files are queued by the existing trigger.
- Added a delete action for sent messages in the chat UI.
- Added authenticated Edge Function `voice-legacy-migrate`.
- Legacy root-level voice objects are migrated lazily only by the original sender when that sender opens the chat.
- Migration copies the encrypted object to `<chat_id>/<sender_id>/<random>.bin`, rewrites the encrypted message marker client-side, creates attachment metadata, then removes the old object.
- If removal of the old object fails, it is queued for `storage-cleanup`.
- Added `voice_storage_migration_status` to monitor remaining legacy objects.

## Deployment order

1. Apply `202607190007_message_deletion_and_legacy_voice.sql`.
2. Deploy `voice-legacy-migrate` and `storage-cleanup`.
3. Deploy the frontend.
4. Let original senders open their chats so their old voice messages migrate.
5. Check `select * from public.voice_storage_migration_status;`.
6. Only when `legacy_root_objects = 0`, remove the temporary root-level read branch from the Stage 15 Storage policy.

## Compatibility

Legacy files sent by other users remain playable until their original sender opens the chat. The system never rewrites another sender's signed encrypted message.
