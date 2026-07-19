# Stage 11 — Lifecycle, Realtime and dependency cleanup

## Scope

This stage focuses on runtime stability and frontend performance without changing user-facing features or the database schema.

## Changes

- Added centralized tracking and cleanup for application-level Supabase Realtime channels.
- Added centralized tracking and cleanup for background polling intervals.
- Reduced device-request fallback polling from every 3 seconds to every 10 seconds; Realtime remains the primary mechanism.
- Fixed QR login channel cleanup so rapid view changes do not leave stale subscriptions behind.
- Added cancellation guards to prevent an unmounted QR screen from updating state or completing a stale login.
- Split chat Realtime handling into INSERT and UPDATE events instead of subscribing to every event type.
- Added realtime message persistence to IndexedDB and bounded each chat cache to the latest 500 encrypted messages.
- Added cancellation guards around asynchronous message decryption.
- Fixed object URL lifecycle for encrypted voice messages and release audio resources on unmount.
- Replaced random fallback voice waveforms with deterministic values to avoid visual changes on rerender.
- Replaced the remaining Math.random-based device ID with crypto.getRandomValues().
- Added automatic cleanup for temporary QR broadcast channels.
- Restricted the group-member query to required user columns instead of select('*').
- Removed unused server-only packages from the browser application dependencies.
- Moved Vite plugins to devDependencies and removed the duplicate Vite runtime dependency.
- Removed accumulated one-off root patch scripts and local database test helper files.
- Added `npm run check` to run TypeScript validation and production build together.

## Removed frontend dependencies

- @google/genai
- @simplewebauthn/server
- dotenv
- express
- jose
- nodemailer
- @types/express
- @types/nodemailer

The Edge Functions use Deno/npm imports directly and do not require these packages in the frontend package.json.

## Validation

TypeScript parsing reached dependency resolution without reporting syntax errors in the modified files. A full lint/build could not complete because package installation exceeded the execution environment timeout and no complete node_modules directory was produced.

Run locally:

```bash
npm install
npm run check
```

## Manual checks

- Open and close QR login repeatedly and confirm only one `qr-login-*` channel is visible.
- Switch between chats and confirm only the current `live-chat-*` channel remains.
- Start device synchronization, navigate away, and confirm polling stops after application teardown.
- Play several voice notes and confirm only one plays at a time and memory does not continuously grow.
- Receive and edit messages and confirm the encrypted cache is updated.
