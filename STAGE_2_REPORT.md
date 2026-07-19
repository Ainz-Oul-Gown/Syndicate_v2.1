# Stage 2 — Supabase/Firebase environment configuration

## Fixed

- GitHub Pages workflow now explicitly passes required Vite environment variables to the production build.
- Removed the repository-specific Firebase JSON configuration from source control.
- Firebase browser configuration now comes from `VITE_FIREBASE_*` variables and fails with a clear error when incomplete.
- Simplified `.env.example` and clearly separated public browser configuration from server-only secrets.
- Replaced the obsolete AI Studio README with deployment instructions for GitHub Pages, Supabase, and Firebase.
- Kept `.env*` ignored while preserving `.env.example`.

## Security boundary

`VITE_*` values are embedded in the public JavaScript bundle. The Supabase anon key and Firebase web configuration may be public, but they do not replace RLS, Storage policies, authorized-domain restrictions, or server-side authentication checks.

The existing `auth-custom` Edge Function remains a critical authentication risk and was intentionally not modified in this stage, because replacing it safely requires coordinated changes to login flows and deployed Supabase functions.
