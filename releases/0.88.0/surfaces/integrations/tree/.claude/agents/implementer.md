<!-- nina:slot integrations.1 -->
- If you change anything that touches an integration boundary, or add a call into one, flag it explicitly in the diff summary so the reviewer dispatches **integration-tester** before approving.

<!-- nina:slot integrations.3 -->

## Integrations
- All access to a dependency goes through its **boundary module**, named in `.nina/profile.json`. **Never** reach it directly from a service, route, queue consumer or scheduled handler.
- For a `live-api`, the contract-test suite is the source of truth and **both** implementations must pass it. Inject the mock in tests — and never let the mock be the only thing that ran.
- Honor the spec's **Integration premises** verbatim. If one looks wrong while you are writing code against it, STOP and loop back to the architect. Do not work around a premise: the premise is the contract, and a contract that is wrong gets fixed, not bypassed.

<!-- nina:slot integrations.4 -->
- Reach an integration from anywhere outside its boundary module. Inject the mock in tests.
