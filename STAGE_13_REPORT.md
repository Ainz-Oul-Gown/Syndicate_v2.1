# Stage 13 — Message delivery and history pagination

## Completed

- Added optimistic text-message rendering before the network request completes.
- Added explicit `sending`, `failed`, and `sent` delivery states for outgoing text messages.
- Failed text messages remain visible and can be retried without retyping.
- Successful inserts return the canonical database row and replace the temporary client message.
- Realtime races are deduplicated by the final message UUID.
- Added server pagination for older history in pages of 100 messages.
- Initial history remains limited to the latest 200 messages.
- IndexedDB remains capped at the latest 500 encrypted messages per chat.
- Older pages can still remain visible for the current session without expanding permanent cache indefinitely.
- Pagination state is reset when switching chats.

## Behaviour notes

- Optimistic retry currently applies to text messages and replies.
- Voice-message upload has its own multi-step Storage/database flow and remains unchanged in this stage.
- The “load older messages” control appears after the locally rendered history has been expanded.

## Verification

Run locally:

```bash
npm install
npm run check
```

The review environment does not contain installed npm packages. TypeScript parsing reached the changed JSX without reporting syntax errors; the remaining diagnostics are missing-module errors.
