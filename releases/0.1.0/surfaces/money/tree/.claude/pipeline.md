<!-- nina:slot money.1 -->
  - **Money-movement invariants respected** — split never exceeds entry; remainder parked not distributed; payouts idempotent; every transition writes `{{AUDIT_MODEL}}`.

<!-- nina:slot money.2 -->
- **Reviewer flags a money-movement invariant violation** (split exceeds entry, non-idempotent payout, missing {{AUDIT_MODEL}}) → loop back to architect.
