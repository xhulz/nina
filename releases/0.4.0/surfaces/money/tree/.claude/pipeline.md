<!-- nina:slot money.1 -->
  - **Money invariants respected** — a distribution never exceeds the amount; a shortfall is parked, not distributed; transfers idempotent; every transition audited.

<!-- nina:slot money.2 -->
- **Reviewer flags a money invariant violation** (distribution exceeds the amount, shortfall silently distributed, non-idempotent transfer, missing audit row) → loop back to architect.
