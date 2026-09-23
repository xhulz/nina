<!-- nina:slot money.1 -->
7. **No cache on a read that feeds a money write.** Anything that loads an amount or a balance before computing, approving or dispatching a transfer MUST NOT carry a `cacheStrategy`. A stale amount contaminates a real money movement, and that damage is not undone by fixing the cache afterwards. **Hard reject if violated.**

<!-- nina:slot money.2 -->
9. **Monetary columns are integer.** Money is stored as an integer of the currency's minor unit ({{MINOR_UNIT}}); percentages are basis points. Reject `Decimal`, `Float`, or any type that can hold a fraction of the minor unit.

<!-- nina:slot money.3 -->
10. **Money-integrity constraints.** When the change touches the record of an outbound transfer, verify the **unique constraint on its idempotency key** exists (`@unique` in the schema → `UNIQUE` in the migration SQL). That constraint is what still holds when the application-level guard fails; a missing or dropped one is a **hard reject**. Verify likewise any uniqueness the ownership model depends on.

<!-- nina:slot money.4 -->
- Approve a query annotated with `cacheStrategy` if it feeds a money write.

<!-- nina:slot money.5 -->
- Approve a change to an outbound-transfer record that lacks the unique constraint on its idempotency key.
