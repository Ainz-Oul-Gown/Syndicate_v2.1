# Stage 35 — Chat and message pinning

- Pinned chats are stored locally per signed-in user.
- Chat order is: pinned, unread, then the existing order.
- Group and private chats expose a compact pin control that does not open the chat.
- Messages can be pinned locally per user and chat.
- Pinned messages are marked inside the conversation and a compact bar jumps to the latest pinned message.
- Deleted messages are automatically removed from the local pinned set.
- No message plaintext or new server-side metadata is introduced.
