<!-- nina:slot money.1 -->

## Money invariants you MUST honor
- **A distribution may NEVER exceed the amount** → block. Implement the reject; never clamp and continue.
- **A shortfall is parked, not distributed.** Surface it and leave the remainder where it is — never auto-distribute it, never absorb it quietly.
- **Transfers are idempotent — never sent twice.** Dedupe at the serialization point via the key, *before* the side effect. A retry, a re-delivered message or a double-click must not produce a second transfer.
- **Every state transition writes an audit row** (entity, from → to, actor). No transition without a trail.
- The deterministic money logic lives in `{{CORE_PKG}}` — call it as a pure function; never embed the arithmetic in a service.

<!-- nina:slot money.2 -->
- Embed money arithmetic (sums, deltas, value comparisons, distribution math) inline in a service. Computation lives in `{{CORE_PKG}}`.
