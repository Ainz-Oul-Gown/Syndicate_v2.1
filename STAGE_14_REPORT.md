# Stage 14 — CI and reliable voice delivery

## Changes
- Added a dedicated GitHub Actions quality workflow using `npm ci` when a lock file exists, otherwise `npm install`, followed by `npm run check`.
- Added optimistic voice-message bubbles with immediate local playback.
- Added retry support for failed voice messages.
- Voice uploads now use collision-resistant names with `crypto.randomUUID()`.
- If database insertion fails after Storage upload, the orphaned encrypted file is removed.
- Local object URLs are revoked after successful delivery.
- Fixed duplicated and malformed delivery fields in `DecryptedMessage`.

## Manual checks
1. Record and send a voice message online.
2. Disable network before sending and verify the failed state and Retry button.
3. Re-enable network and retry.
4. Confirm the temporary local voice bubble is replaced by the server message.
5. Confirm GitHub Actions `Quality checks` passes on push/PR.

- Removed obsolete one-off patch scripts left in the repository root.
