<!-- nina:slot money.1 -->
5. **Money-movement abuse (Hard Rules #3, #4, #5)** — **the money path is LIVE against a real provider; this is not a stub audit.** Is the idempotency contract (no payout sent twice) actually enforced at the seam — per-account DO, `blockConcurrencyWhile`, the SQLite ledger, the `idempotencyKey` unique, and `{{PROVIDER_REF_FIELD}} @unique` on the way in? Can a replay, a double-click, a queue redelivery, or a `clearProcessedEntry` call cause a double-send? Can a split exceed the entry or a shortfall be silently distributed? Is the money-OUT authorization gate (`/webhooks/{{PROVIDER_SLUG}}-transfer-validation`) forgeable? Is every state transition forced through an {{AUDIT_MODEL}} write? Flag any seam that is structurally unable to enforce its invariant.

<!-- nina:slot money.2 -->
7. **Idempotency-key & replay surface** — keys unguessable/collision-resistant where it matters; dedup enforced before the side effect, not after.
