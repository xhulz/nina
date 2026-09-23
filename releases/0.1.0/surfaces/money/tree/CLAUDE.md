<!-- nina:slot money.1 -->
3. **Payouts are idempotent — a transfer is NEVER sent twice.** Every payout carries an idempotency key; deduplication is enforced through the per-account Durable Object (`blockConcurrencyWhile` + a SQLite ledger) before anything reaches {{PROVIDER}}. A retry, a re-delivered queue message, or a double-click must never produce a second transfer. This is the highest-blast-radius invariant in the system.

<!-- nina:slot money.2 -->
4. **Escrow balance integrity — money in = money out + retained.** A rule's distribution may NEVER exceed the matched entry value → **block**. If the distribution is **less** than the entry, **alert** the user and leave the remainder **parked** in escrow (never silently distributed). All arithmetic is `BigInt` centavos. The LLM never computes a monetary value.

<!-- nina:slot money.3 -->
5. **State-machine integrity.** `{{ENTRY_MODEL}}`: `DETECTADA → CASADA | DIVERGENTE | SEM_REGRA`. `{{PAYOUT_MODEL}}`: `PENDENTE_APROVACAO → TRANSFERENCIA_AUTOMATICA | TRANSFERENCIA_ALTERADA_MANUALMENTE → TRANSFERIDO → CONFIRMADO | FALHA`. Only the defined transitions are legal, and **every transition writes an `{{AUDIT_MODEL}}` row** (who/when/from→to). Skipping or inventing a state is a hard reject.
