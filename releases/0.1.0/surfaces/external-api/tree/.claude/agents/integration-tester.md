<!-- nina:slot external-api.1 -->
| `resend:resend` | the email transport path |

<!-- nina:slot external-api.2 -->
2. **{{PROVIDER}} — a real, live payment provider** (sandbox + production). *Their* API is the contract; we conform to it. There IS a real service to hit, and money moves through it. So for {{PROVIDER}} you run the **contract-test suite** at `{{PROVIDER_PKG}}/test/contract/` against **BOTH** `{{PROVIDER_MOCK}}` **and** `{{PROVIDER_HTTP}}`, and you check each `P-AS<n>` premise in `.claude/integrations/{{PROVIDER_DOC}}`.

<!-- nina:slot external-api.3 -->
- `{{API_DIR}}/src/auth/**` (any {{AUTH_LIB}} config or wrapper) — runtime against the real plugin

<!-- nina:slot external-api.4 -->
- Any code calling `auth.api.*` (any {{AUTH_LIB}} plugin endpoint) — exercise the real call

<!-- nina:slot external-api.5 -->
- `{{PROVIDER_PKG}}/**` or any new {{PROVIDER}} client call — run the contract-test suite against `{{PROVIDER_MOCK}}`

<!-- nina:slot external-api.6 -->
- For **{{PROVIDER}}**: `.claude/integrations/{{PROVIDER_DOC}}` — the published contract and premises P-AF1..P-AF5. This is the source of truth the mock must conform to.

<!-- nina:slot external-api.7 -->

## You MUST — {{PROVIDER}}

- **Run the contract-test suite** at `{{PROVIDER_PKG}}/test/contract/` against **both** implementations (`*.contract.test.ts` for the mock, `*.http-contract.test.ts` for the HTTP client). Every `P-AS<n>` in `.claude/integrations/{{PROVIDER_DOC}}` maps to a case — verify every one that the diff touches.
- **Never accept a green mock as proof.** If only the mock run is green, you have verified nothing about production. Say so and reject.
- **Confirm nothing calls {{PROVIDER}} outside `{{PROVIDER_PKG}}`.** Grep the diff and the tree for raw HTTP or client construction outside the package boundary. Any leak is a hard reject — all access goes through the typed `{{PROVIDER_CLIENT}}`.
- **Confirm `fetch` is bound to `globalThis` inside the client.** As an unbound instance method it throws *illegal invocation* under workerd and takes the whole {{PROVIDER}} path down in the deployed Worker — unit tests do not catch it. Guard: `{{API_DIR}}/test/integration/{{PROVIDER_SLUG}}-http-client-fetch-binding.integration.test.ts`.

<!-- nina:slot external-api.8 -->
- **Confirm DTOs validate with Zod at the package boundary** (in both implementations), so live-API drift surfaces structurally.
- **Update `.claude/integrations/{{PROVIDER_DOC}}` when you observe new behavior**, with the evidence that settled it (contract case, sandbox response, or source citation).
