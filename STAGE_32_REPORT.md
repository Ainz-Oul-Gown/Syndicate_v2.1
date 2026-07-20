# Stage 32 — Message deletion correctness

- Checks the boolean result returned by `delete_own_message`; local UI is changed only after server confirmation.
- Handles Realtime `DELETE` events and removes deleted messages from React state and IndexedDB on every connected device.
- Reconciles the latest 500 server messages with the local cache whenever a chat opens, preventing remotely deleted messages from returning from stale cache.
- Keeps older cached history outside the reconciliation window for backward pagination.
