# Stage 15 — Voice Storage security and orphan cleanup

## Changes

- The `voice_messages` bucket is explicitly private and limited to 15 MiB encrypted binary objects.
- New voice files use the path `<chat_id>/<uploader_id>/<random>.bin`.
- Storage RLS permits upload/download only to chat members; deletion is limited to the uploader.
- Added `message_attachments` to bind each new voice object to its message, chat and uploader.
- Attachment rows cascade when a message or chat is deleted.
- Deleted attachment paths are queued in `storage_cleanup_queue`.
- Added `storage-cleanup` Edge Function to remove queued Storage objects using the service role.
- Failed attachment metadata creation rolls back the message and removes the uploaded file.
- Group deletion triggers best-effort queued object cleanup.

## Compatibility

Legacy root-level voice objects remain readable by authenticated users temporarily because their old names do not contain a chat ID. They remain encrypted end-to-end, but should eventually be migrated to the new path format and then the legacy read branch should be removed.

## Deploy order

1. Back up the database and Storage.
2. Apply `202607190006_voice_storage_security.sql`.
3. Deploy `storage-cleanup`.
4. Deploy the frontend.
5. Optionally schedule `storage-cleanup` periodically or invoke it after administrative cleanup.
