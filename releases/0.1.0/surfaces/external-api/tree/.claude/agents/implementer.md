<!-- nina:slot external-api.1 -->
- If you change anything that touches an external-library integration surface ({{AUTH_LIB}}, Prisma Accelerate cache, R2/KV/Queues/Durable Objects bindings, third-party HTTP), flag it explicitly in the diff summary so the reviewer dispatches **integration-tester** before approving.

<!-- nina:slot external-api.2 -->
- If you change anything in `{{PROVIDER_PKG}}/`, flag it explicitly in the diff summary so the reviewer dispatches **integration-tester** to run the contract-test suite against BOTH implementations before approving.

<!-- nina:slot external-api.3 -->

## {{PROVIDER}}
- All {{PROVIDER}} access goes through `{{PROVIDER_PKG}}` (the typed `{{PROVIDER_CLIENT}}` + `{{PROVIDER_HTTP}}` + `{{PROVIDER_MOCK}}`). **Never** make raw HTTP calls to {{PROVIDER}} from a service, route, DO, or queue.
- {{PROVIDER}} is a **real, live provider**; its API is the contract. The contract-test suite at `{{PROVIDER_PKG}}/test/contract/` is the source of truth and **both** implementations must pass it.
- Money crosses the boundary as `BigInt` centavos. Reais⇄centavos conversion lives only in `src/money.ts` / `src/wire-money.ts` — never `Number`, never in a service.
- Inject the mock in tests.

<!-- nina:slot external-api.4 -->
- Make raw HTTP calls to {{PROVIDER}} from anywhere outside `{{PROVIDER_PKG}}`. Inject `{{PROVIDER_MOCK}}` in tests.
