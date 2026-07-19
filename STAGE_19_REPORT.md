# Stage 19 — Debt settlement integrity

## Fixed

- Debt records now have a lifecycle: `active`, `payment_pending`, `settled`, `cancelled`.
- A debtor can no longer delete a debt to mark it paid.
- A debtor requests settlement; only the creditor can confirm or reject it.
- A creditor may forgive an open debt.
- Only the party who originally created an active debt may cancel it.
- Creating a debt now uses an atomic RPC and requires an accepted friendship.
- Direct browser writes to `debts` are disabled; reads remain private to the two parties.
- Existing debts are migrated as active and attributed to the debtor to preserve current behavior.
- Currency names are unique per owner, case-insensitively.

## Deployment

1. Back up the database.
2. Apply `supabase/migrations/202607190010_debt_settlement_integrity.sql`.
3. Deploy the updated frontend.
4. No Edge Function redeploy is required.

## Compatibility

The existing “I owe” flow remains available. The only behavior change is that marking a debt as paid now requires creditor confirmation.
