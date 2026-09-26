<!-- nina:slot money.1 -->
- **Enforce the money invariants. Each violation is a HARD REJECT → loop back to architect:**
  - **A distribution may NEVER exceed the amount.** It is blocked, not clamped. A retention is just another destination — same arithmetic, in integer {{MINOR_UNIT}}.
  - **A shortfall must be parked, not silently distributed.** The remainder stays where it is, and the shortfall is surfaced to whoever is owed it.
  - **Transfers must be idempotent — never sent twice.** Every transfer carries a key, and dedupe happens at the serialization point before the side effect. A retry, a re-delivered message or a double-click must never produce a second transfer.
  - **Every state transition writes an audit row** (entity type, id, from, to, actor) and follows the transitions declared in `.claude/architecture.md`. An undeclared transition, or one missing its audit row, is a hard reject.

<!-- nina:slot money.2 -->
- **money-invariants** — a distribution never exceeds the amount; a shortfall is parked, never
  distributed; transfers idempotent at the serialization point; an audit row on every transition;
  integer {{MINOR_UNIT}} and basis points; no arithmetic outside `{{CORE_PKG}}`.

<!-- nina:slot money.3 -->
- `{{CORE_PKG}}` money logic touched (distribution and transfer generation are high-blast-radius)

<!-- nina:slot money.4 -->
- Approve a change that lets a distribution exceed the amount, silently distributes a shortfall, sends a transfer without idempotent dedupe, or skips an audit row — those are hard rejects, loop back to architect.

<!-- nina:slot money.5 -->
- **If APPROVED:** ≤300 words. Sections: Verification commands run (typecheck/lint/build only — NEVER vitest), Spec-match (✅/❌ per item), Hard-rule checks (tenant scoping ✅, integer {{MINOR_UNIT}} / bps ✅, each gate the diff triggered ✅ (`.claude/graph.md`), money invariants ✅ — distribution ≤ amount, shortfall parked, idempotent transfer, audit row on transition), QA-attention flags (list any condition from the "stricter audit" list so QA knows what to focus on), Final verdict.

<!-- nina:slot money.6 -->
- Money invariant violated (distribution exceeds the amount, shortfall silently distributed, non-idempotent transfer, missing audit row) → back to **architect** for redesign.
