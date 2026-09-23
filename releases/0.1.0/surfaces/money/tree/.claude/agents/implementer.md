<!-- nina:slot money.1 -->

## Money invariants you MUST honor
- **Split distribution may NEVER exceed the matched entry value** → block. Implement the reject, never clamp-and-continue.
- **Shortfall is parked, not distributed.** When the distribution is less than the entry, surface the "sobra" alert and leave the remainder parked in escrow — never auto-distribute it.
- **Payouts are idempotent — a transfer is NEVER sent twice.** Dedup every payout via the per-account Durable Object (`{{SERIALIZER}}`, `blockConcurrencyWhile` + its SQLite ledger); a retry, a re-delivered queue message, or a double-click must not produce a second transfer.
- **Every state transition writes an `{{AUDIT_MODEL}}` row** (entity, from→to, actor). No transition without an audit trail.
- The deterministic money logic (match / split / payout generation) lives in `{{CORE_PKG}}` — call it as a pure function, never embed the arithmetic inline in a service.

<!-- nina:slot money.2 -->
- Embed money arithmetic (sums, deltas, value comparisons, split math) inline in a service. Computation lives in `{{CORE_PKG}}`.
