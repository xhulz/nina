<!-- nina:slot money.1 -->
- **Money-movement abuse (Hard Rules #3, #4, #5)** — **the money path reaches a real service; this is not a stub audit.** Is the idempotency contract actually enforced at the seam — the unique key, the serialization point, and the dedupe happening *before* the side effect? Can a replay, a double-click, a queue redelivery, or a manual reset of processed state cause a double send? Can a distribution exceed the amount, or a shortfall be silently distributed? Is whatever authorizes money OUT forgeable — a webhook without a verified signature, a callback trusted on its word? Is every state transition forced through an audit write? Flag any seam that is structurally unable to enforce its invariant, even where nothing has exploited it yet.

<!-- nina:slot money.2 -->
- **Idempotency-key & replay surface** — keys unguessable and collision-resistant where it matters; dedup enforced before the side effect, not after.
