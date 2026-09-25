<!-- nina:slot integrations.1 -->

### Integration-tester is a guardrail for integration boundaries
Invoke **integration-tester** any time the diff touches the boundary module of a declared integration, or adds a call into one. It runs the real dependency, never a mock of it; for a `live-api` it runs the **contract-test suite against BOTH implementations**, so the mock can never pass while the live path is broken. No such change merges without its approval.

The architect's spec MUST carry an **Integration premises** section: every behavior the implementation relies on, each with the evidence its kind requires — `node_modules/.pnpm/<lib>@<version>/...:<line>` for an installed library, a contract case or an observed response for a live API, the local emulator for a platform binding. Never by inference.
