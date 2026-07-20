# Stage 27 — Encrypted per-chat drafts

## Implemented
- Draft text is stored separately for each user and chat.
- Drafts are encrypted with the active chat AES-GCM key before being written to IndexedDB.
- Drafts are restored after reopening a chat or restarting the installed PWA.
- Textarea height is restored together with the draft.
- Draft storage is debounced to avoid excessive writes on mobile devices.
- A draft is removed only after the server confirms successful message insertion.
- Manually clearing the composer removes the saved draft.
- Failed sends keep the encrypted draft available for recovery.

## Compatibility
- Static GitHub Pages deployment.
- Browser and standalone PWA.
- Telegram WebView.
- Future PWA-to-APK/WebView packaging.

## Verification
- `npm ci --ignore-scripts`
- `npx tsc --noEmit`
- `npm run build`

Production build completed successfully. Existing large-chunk and `onnxruntime-web` eval warnings remain unrelated to this change.
