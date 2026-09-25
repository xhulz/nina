<!-- nina:slot money.1 -->
- **Confirm idempotency holds end to end.** Two sends with the same key → one logical transfer, no double send, and the serialization point refuses the second. This is the highest-blast-radius invariant in the system — drive it explicitly against the real service; do not infer it from reading the code.
- **Confirm money crosses the boundary as an integer of the minor unit**, and that conversion happens only in the module that owns it — never in a service, never through a floating-point type.
