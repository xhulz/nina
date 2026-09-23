<!-- nina:slot money.1 -->
- **Confirm idempotency holds end to end.** Two `enviarTransferencia` calls with the same `idempotencyKey` → one logical transfer, no double send, and the per-account DO's SQLite ledger refuses the second. This is the highest-blast-radius invariant in the system — drive it explicitly, do not infer it.
- **Confirm money crosses the boundary as `BigInt` centavos** and that reais⇄centavos conversion happens only in `src/money.ts` / `src/wire-money.ts` — never via `Number`, never in a service.
