<!-- nina:slot money.1 -->
7. **No cache on conciliation/payout-feeding reads.** Any read that feeds a **conciliation or payout write** — anything that loads an `{{ENTRY_MODEL}}` or `{{ACCOUNT_MODEL}}.balanceCents` before matching, generating, approving, or sending a payout/batch — MUST NOT carry a `cacheStrategy`. A stale `{{ENTRY_MODEL}}` or `{{ACCOUNT_MODEL}}.balance` contaminates real money movement. **Hard reject if violated.**

<!-- nina:slot money.2 -->
9. **Monetary columns.** Money is `BigInt` (Postgres `BIGINT`), stored in centavos (`R$ 12,53 → 1253`). Percentages are basis points stored as `Int`. Reject `Decimal`, `Float`, or `Int` for monetary values (Int is for bps only).

<!-- nina:slot money.3 -->
10. **Money-integrity invariants.** When the change touches `{{PAYOUT_MODEL}}` or `{{BATCH_MODEL}}`: verify the unique `idempotencyKey` constraint/index exists on the model (`@unique` in schema → `UNIQUE` in the migration SQL). This backs the "a transfer is never sent twice" invariant; a missing or dropped uniqueness on `idempotencyKey` is a **hard reject**. Likewise confirm `{{ACCOUNT_MODEL}}.userId` is `@unique` (1:1 escrow account per user) when `{{ACCOUNT_MODEL}}` is touched.

<!-- nina:slot money.4 -->
- Approve a query annotated with `cacheStrategy` if it feeds a conciliation or payout write.

<!-- nina:slot money.5 -->
- Approve a `{{PAYOUT_MODEL}}` or `{{BATCH_MODEL}}` change that lacks the unique `idempotencyKey` constraint.
