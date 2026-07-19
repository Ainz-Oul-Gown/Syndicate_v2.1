# Stage 10 — Browser secrets and client hardening

- JWT moved from persistent localStorage to per-tab sessionStorage, with one-time migration.
- URL-fragment bearer-token login disabled; any legacy token fragment is removed immediately.
- Added a restrictive CSP and no-referrer policy.
- PIN hashes upgraded to PBKDF2-SHA256 with a random 128-bit salt and 310,000 iterations.
- PIN verification uses constant-time byte comparison and upgrades legacy hashes after successful unlock.
- Added centralized helpers for session token and sensitive browser-state cleanup.

Compatibility: users remain signed in in the current tab. Closing the tab/browser requires signing in again. Existing PIN hashes upgrade automatically.
