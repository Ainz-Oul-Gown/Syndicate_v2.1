# Stage 8 — Trusted device synchronization

## Fixed
- Device IDs now use `crypto.getRandomValues`, not `Math.random`.
- A new device is not inserted into `user_devices` before it actually possesses the account signing key.
- Trusted-device registration is handled by `device-register` and requires an ECDSA signature.
- Approval/rejection is handled by `device-request-respond` and requires a signature from the account key.
- The requester device cannot approve itself.
- Requests expire after 10 minutes and can only transition once from `pending`.
- Browser RLS can no longer update approval state or insert/update trusted devices directly.

## Deploy
1. Apply `supabase/migrations/202607190004_device_request_security.sql`.
2. Deploy `device-register` and `device-request-respond`.
3. Deploy the frontend.
