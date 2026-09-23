<!-- nina:slot money.1 -->
11. **Money-movement invariants** — if the spec touches matching, split, payout generation, or {{PROVIDER}} export, explicitly confirm the design honors:
    - Money is `BigInt` centavos end-to-end; percentages are basis points. Never `number` for money.
    - A rule's total distribution may NEVER exceed the matched entry value → **block** (reject the rule/entry).
    - A distribution **less** than the entry → **allow**, surface a shortfall alert, leave the remainder **parked** in escrow — never silently distributed.
    - Payouts are **idempotent** — a transfer is NEVER sent twice. Dedup is enforced through the per-account Durable Object (`blockConcurrencyWhile` + its SQLite ledger) via an idempotency key before anything reaches {{PROVIDER}}.
    - Every legal state transition (`{{ENTRY_MODEL}}`, `{{PAYOUT_MODEL}}`) writes an `{{AUDIT_MODEL}}` row (who/when/from→to). Illegal transitions throw.

    If the design cannot satisfy all of these, redesign before submitting the spec.

<!-- nina:slot money.2 -->
- Design a money movement that can exceed the matched entry value, silently distribute a shortfall, or send a transfer twice. If the design needs monetary computation, that computation lives in `{{CORE_PKG}}` as a pure function — never inline in a service or route.
