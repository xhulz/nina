<!-- nina:slot external-api.1 -->
- **Queue** (`{{API_DIR}}/src/queues/<q>.ts`) / **Webhook** (`{{API_DIR}}/src/routes/{{PROVIDER_SLUG}}-*.ts`): same discipline — validate input, build deps, call one service function. There are no cron handlers; the system is webhook-driven.

<!-- nina:slot external-api.2 -->
8. **All {{PROVIDER}} calls live in `{{PROVIDER_PKG}}`.** Services import the typed interface (`abrirContaEscrow`, `consultarStatusKyc`, `consultarStatusOnboarding`, `enviarTransferencia`, `consultarStatusTransferencia`, `registrarWebhook`, `removerWebhook`). Services do not instantiate an HTTP client directly.

<!-- nina:slot external-api.3 -->

---

## {{PROVIDER}} client conventions (enforced by integration-tester + reviewer)

All {{PROVIDER}} access lives in `{{PROVIDER_PKG}}`. **{{PROVIDER}} is a real, live provider and its API is the contract** — we conform to it, we do not define it.

- **One interface, two implementations.** `{{PROVIDER_CLIENT}}` is our adapter spec. `{{PROVIDER_MOCK}}` is deterministic and in-memory; `{{PROVIDER_HTTP}}` calls the real API. Services depend on the interface only.
- **Contract-test suite is the source of truth.** `{{PROVIDER_PKG}}/test/contract/` exercises every method. **BOTH** implementations must pass it — a mock that is green while the HTTP client is not is a lie, and a hard reject.
- **No raw HTTP to {{PROVIDER}} outside `{{PROVIDER_PKG}}`.** A service, route, DO or queue calling {{PROVIDER}} directly is a hard reject.
- **`fetch` must be bound to `globalThis`** inside the client. As an unbound instance method it throws *illegal invocation* in workerd and takes down the whole {{PROVIDER}} path in the deployed Worker (regression guard: `{{API_DIR}}/test/integration/{{PROVIDER_SLUG}}-http-client-fetch-binding.integration.test.ts`).
- **Money crosses the boundary as `BigInt` centavos.** Reais⇄centavos conversion lives ONLY in `src/money.ts` / `src/wire-money.ts` — never in a service, never via `Number`.
- **Validate {{PROVIDER}} responses with Zod** at the package boundary — even in the mock — so live-API drift is caught structurally.

<!-- nina:slot external-api.4 -->
- **{{PROVIDER}}:** the contract-test suite in `{{PROVIDER_PKG}}/test/contract/` runs against BOTH `{{PROVIDER_MOCK}}` and `{{PROVIDER_HTTP}}`. Worker integration tests inject the mock; the live gate exercises the sandbox.
