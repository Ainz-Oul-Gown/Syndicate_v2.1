# Stage 28 — Draft indicators in chat list

## Implemented
- Added encrypted draft preview loading from IndexedDB using each chat AES key.
- Added live draft-change events so the main chat list updates without a reload.
- Added `Черновик: …` previews for Saved Messages, group chats, and private chats.
- Preview text is whitespace-normalized and truncated to 72 characters.
- Draft labels disappear immediately after clearing or successfully sending a message.
- Draft plaintext remains encrypted at rest; only non-sensitive chat metadata is stored beside the encrypted payload.
- Existing Stage 27 encrypted draft payloads remain readable.

## Validation
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- PWA service worker and precache were regenerated.
