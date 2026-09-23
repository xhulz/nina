<!-- nina:slot money.1 -->

---

## Monetary values & percentages

- **Money is always `BigInt` in centavos** end-to-end. `R$ 12,53` is `1253n`. Source of precision is `packages/shared/src/money.ts`.
- **Percentages are stored as basis points** (`bigint` or `number` of bps: `40% → 4000`, `100% → 10000`) so a split is exact without floating point.
- **Never** use `number` for money. **Never** convert to `number` before formatting.
- Conversion helpers in `packages/shared`:
  - `parseBrl(input: string): bigint` — accepts `"R$ 12,53"`, `"12,53"`, `"12.53"`, returns centavos.
  - `formatBrl(centavos: bigint): string` — returns `"R$ 12,53"`.
  - `applyBps(centavos: bigint, bps: number): bigint` — exact percentage of a value, rounding rule defined in one place.
- Database monetary columns are `BigInt` (`@db.BigInt`). JSON responses serialize `BigInt` as **strings** (`"1253"`), not numbers. Services own the conversion.

<!-- nina:slot money.2 -->

---

## Split / distribution invariants (enforced by reviewer + core tests)

The split engine lives in `{{CORE_PKG}}/src/split`. It is pure and total over centavos:

- A destination is either `PERCENT` (bps of the matched entry value) or `FIXED` (centavos).
- `totalDistribution = Σ destinations` (computed in centavos).
- `totalDistribution > entry.amount` → **reject** (the rule/entry cannot be processed).
- `totalDistribution < entry.amount` → **allow**, surface a "sobra de R$ X" alert; the remainder is **parked** in escrow, never auto-distributed.
- `totalDistribution = entry.amount` → OK.
- Retention (`ESCROW_RETENTION` or `USER_PERSONAL`) is just another destination — the same arithmetic applies.

<!-- nina:slot money.3 -->

---

## State machines & idempotency (enforced by reviewer)

- **Every money-moving entity is a state machine.** `{{ENTRY_MODEL}}` and `{{PAYOUT_MODEL}}` transitions follow `CLAUDE.md` Hard Rule #5 exactly. Illegal transitions throw; they are never silently coerced.
- **Every transition writes an `{{AUDIT_MODEL}}` row** (`entityType`, `entityId`, `from`, `to`, `actor`). No transition without an audit trail.
- **Payouts are idempotent.** Each carries a unique `idempotencyKey`. Generation and dispatch are deduplicated through the per-account Durable Object (`blockConcurrencyWhile` + a SQLite ledger) before anything reaches {{PROVIDER}}. A retry, a re-delivered queue message, or a double-click MUST NOT produce a second transfer.
- **The per-account DO is the serialization point.** Conciliation and payout generation for an account never run concurrently with themselves.

<!-- nina:slot money.4 -->
6. **Entry processing + payout dispatch go through the per-account DO** (`env.ACCOUNT.idFromName(accountId)`). Routes, queue consumers and MCP tools never run matching or a transfer synchronously.

<!-- nina:slot money.5 -->
7. **The matching + split engine lives in `{{CORE_PKG}}`.** Services call it as a pure function; they do not embed money logic inline.

<!-- nina:slot money.6 -->
- Idempotency on money-moving writes (payout approve, PIX dispatch): the payout carries an idempotency key; the per-account DO dedupes via `blockConcurrencyWhile` + its SQLite ledger.

<!-- nina:slot money.7 -->
- `{{CORE_PKG}}` (match, split, payout generation) is the most-tested package — pure functions over fixtures. Cover the split invariants exhaustively (over, under, exact, mixed percent+fixed, rounding).
