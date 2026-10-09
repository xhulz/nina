<!-- nina:slot money.1 -->

---

## Monetary values & percentages

- **Money is an integer of the currency's minor unit**, end to end — {{MINOR_UNIT}}, never a float, never a type that can hold a fraction of one. Source of precision: `{{MONEY_MODULE}}`.
- **Percentages are basis points** (`40% → 4000`, `100% → 10000`) so a distribution is exact without floating point.
- **Parsing, formatting and percentage arithmetic live in one module and nowhere else.** A second place that turns a string into money is a second rounding rule, and the two will disagree on a value somebody is owed.
- **Never** convert to a floating-point type before formatting, and never let a display format round a stored value.
- Monetary database columns are integer. JSON responses serialize them as **strings**, not numbers, so no client parses them into a float. The service owns the conversion.

<!-- nina:slot money.2 -->

---

## Distribution invariants (enforced by reviewer + unit tests)

The distribution engine lives in `{{CORE_PKG}}`. It is pure and total over integer {{MINOR_UNIT}}:

- A destination is either a percentage (basis points of the amount) or a fixed value.
- `total = Σ destinations`, computed in {{MINOR_UNIT}}.
- `total > amount` → **reject.** Never clamp, never distribute what is not there.
- `total < amount` → **allow**, surface the shortfall, and leave the remainder **parked**. Silence is the defect here: an unexplained remainder is indistinguishable from a bug.
- `total = amount` → OK.
- A retention is just another destination — the same arithmetic applies to it, with no special case.

<!-- nina:slot money.3 -->

---

## State machines & idempotency (enforced by reviewer)

- **Every money-moving entity is a state machine.** Its states and legal transitions are declared in `.claude/architecture.md`; the code follows the declaration, not the other way round. Illegal transitions throw; they are never silently coerced.
- **Every transition writes an audit row** (entity type, entity id, from, to, actor). No transition without a trail — the trail is what makes a money bug diagnosable after the money has moved.
- **Outbound transfers are idempotent.** Each carries a unique key, and dedupe happens before the side effect, at the serialization point.
- **One serialization point per balance.** Whatever computes and dispatches against a single balance never runs concurrently with itself. Two concurrent runs over one balance is how a double send happens even when every individual write is correct.

<!-- nina:slot money.4 -->
- **Money computation and dispatch go through the serialization point.** Routes, queue consumers and tools never run a distribution or a transfer synchronously in the request path.

<!-- nina:slot money.5 -->
- **The distribution engine lives in `{{CORE_PKG}}`.** Services call it as a pure function; they do not embed money logic inline.

<!-- nina:slot money.6 -->
- Idempotency on money-moving writes: the record carries an idempotency key, and the serialization point refuses the second attempt *before* the side effect.

<!-- nina:slot money.7 -->
- `{{CORE_PKG}}` is the most-tested package — pure functions over fixtures. Cover the distribution invariants exhaustively: over, under, exact, mixed percentage and fixed, and rounding.
