<!-- nina:slot money.1 -->
- **Enforce the money-movement invariants. Each violation is a HARD REJECT → loop back to architect:**
  - **Split distribution may NEVER exceed the matched entry value.** `totalDistribution > entry.amount` must be blocked. Retention (`ESCROW_RETENTION` / `USER_PERSONAL`) is just another destination — same arithmetic in `BigInt` centavos.
  - **A shortfall must be parked, not silently distributed.** When `totalDistribution < entry.amount`, the remainder stays parked in escrow with a "sobra" alert surfaced to the user — never auto-distributed.
  - **{{PAYOUT_MODEL}}s must be idempotent — a transfer is NEVER sent twice.** Every payout carries an idempotency key; deduplication is enforced through the per-account Durable Object (`{{SERIALIZER}}`, via `blockConcurrencyWhile` + its SQLite ledger) before anything reaches {{PROVIDER}}. A retry, a re-delivered queue message, or a double-click must never produce a second transfer.
  - **Every state transition writes an `{{AUDIT_MODEL}}` row** (`entityType`, `entityId`, `from`, `to`, `actor`). `{{ENTRY_MODEL}}` and `{{PAYOUT_MODEL}}` follow the legal transitions in `CLAUDE.md` exactly; an illegal or undocumented transition, or one missing its {{AUDIT_MODEL}} write, is a hard reject.

<!-- nina:slot money.2 -->
1. **money-invariants** — split never exceeds the entry; shortfall parked, never distributed;
   payouts idempotent through the DO before anything reaches {{PROVIDER}}; `{{AUDIT_MODEL}}` on every transition;
   `BigInt` centavos and basis points; no arithmetic outside `{{CORE_PKG}}`.

<!-- nina:slot money.3 -->
- `{{CORE_PKG}}` money logic touched (match / split / payout generation is high-blast-radius)

<!-- nina:slot money.4 -->
- Approve a change that lets a split exceed the matched entry, silently distributes a shortfall, sends a payout without idempotent dedupe, or skips an `{{AUDIT_MODEL}}` write — those are hard rejects, loop back to architect.

<!-- nina:slot money.5 -->
- **If APPROVED:** ≤300 words. Sections: Verification commands run (typecheck/lint/build only — NEVER vitest), Spec-match (✅/❌ per item), Hard-rule checks (`userId` scoping ✅, BigInt centavos / bps ✅, dba ✅ if applicable, integration-tester ✅ if applicable, money-movement invariants ✅ — split ≤ entry, shortfall parked, idempotent payout, {{AUDIT_MODEL}} on transition), QA-attention flags (list any condition from the "stricter audit" list so QA knows what to focus on), Final verdict.

<!-- nina:slot money.6 -->
- Money-movement invariant violated (split exceeds entry, shortfall silently distributed, non-idempotent payout, missing {{AUDIT_MODEL}}) → back to **architect** for redesign.
