# Stage 34 — Unread chat markers

- Added a privacy-preserving unread dot to private and group chat rows.
- Message text and unread counts are not displayed.
- Only messages sent by another user mark a chat as unread.
- Opening a chat clears its marker.
- Read state is stored locally per user and chat.
- On app resume/start, recent server messages are reconciled against local read timestamps.
- Realtime inserts update markers while the app is open.
- Production build and PWA service worker generation completed successfully.
