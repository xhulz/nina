<!-- nina:slot money.1 -->
- **Money invariants** — if the spec touches distribution, transfer generation, or a send to the payment integration, explicitly confirm the design honors:
    - Money is integer {{MINOR_UNIT}} end to end; percentages are basis points. Never a floating-point type.
    - A distribution may NEVER exceed the amount → **block** (reject the operation, do not clamp it).
    - A distribution **less** than the amount → **allow**, surface the shortfall, leave the remainder **parked** — never silently distributed.
    - Transfers are **idempotent** — never sent twice. Dedupe happens at the serialization point, via the key, before the side effect.
    - Every legal state transition writes an audit row (who / when / from → to). Illegal transitions throw.

    If the design cannot satisfy all of these, redesign before submitting the spec.

<!-- nina:slot money.2 -->
- Design a money movement that can exceed the amount it distributes, silently absorb a shortfall, or send a transfer twice. If the design needs monetary computation, that computation lives in `{{CORE_PKG}}` as a pure function — never inline in a service or route.
