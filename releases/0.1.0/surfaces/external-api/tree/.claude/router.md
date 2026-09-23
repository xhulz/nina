<!-- nina:slot external-api.1 -->

### 1b. Integration-tester is a guardrail for external-service surfaces
Invoke **integration-tester** any time the diff touches {{AUTH_LIB}}, Prisma Accelerate cache behavior, R2/KV/Queues/Durable Objects, third-party HTTP, OR `{{PROVIDER_PKG}}`. It runs REAL flows against real services; for {{PROVIDER}} it runs the **contract-test suite against BOTH `{{PROVIDER_MOCK}}` and `{{PROVIDER_HTTP}}`**, so the mock can never pass while the live path is broken. No such change merges without its approval.

The architect's spec MUST include an **External library premises** section with `node_modules/.pnpm/<lib>/...:<line>` citations for every real-library behavior the implementer depends on. For {{PROVIDER}} — a live third-party API, not a library on disk — a premise is settled by a `P-AS<n>` in `.claude/integrations/{{PROVIDER_DOC}}`, a contract-test case, or an observed sandbox response. Never by inference.
