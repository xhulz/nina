<!-- nina:slot external-api.1 -->
| **ANY external-library integration surface** ({{AUTH_LIB}} `{{API_DIR}}/src/auth/**` or `auth.api.*` call, Prisma Accelerate cache, R2/KV/Queues/Durable Objects bindings, third-party HTTP) | architect MUST cite premises with `node_modules:<line>` references in the spec; **+ integration-tester before reviewer** |

<!-- nina:slot external-api.2 -->
| **ANY {{PROVIDER}} surface** (`{{PROVIDER_PKG}}/**` or a new `{{PROVIDER_CLIENT}}` call) | architect cites the {{PROVIDER}} premises in `.claude/integrations/{{PROVIDER_DOC}}`; **+ integration-tester runs the contract-test suite against BOTH `{{PROVIDER_MOCK}}` and `{{PROVIDER_HTTP}}` before reviewer** |

<!-- nina:slot external-api.3 -->
- **integration-tester** → mandatory gate on external-service surfaces; runs REAL flows against real services ({{AUTH_LIB}}, Cloudflare bindings, the {{PROVIDER}} **sandbox**); for **{{PROVIDER}}** runs the **contract-test suite** against both the mock and the HTTP client so they cannot diverge; verifies every cited premise; updates `.claude/integrations/<lib>.md`

<!-- nina:slot external-api.4 -->
11. **The {{PROVIDER}} contract is THEIRS, and it is live.** All {{PROVIDER}} access goes through `{{PROVIDER_PKG}}` — never raw HTTP to {{PROVIDER}} from a route, service, DO, or queue. `{{PROVIDER_HTTP}}` and `{{PROVIDER_MOCK}}` MUST both pass the same contract-test suite; a mock that passes while the HTTP client does not is a lie, and a hard reject. Because the API is real, a premise is only settled by the installed source, the contract suite, or an observed sandbox response — never by inference. `fetch` inside the client must be bound to `globalThis` (workerd throws *illegal invocation* otherwise).

<!-- nina:slot external-api.5 -->
12. **External-library premises require `node_modules:<line>` citations in the spec.** The architect MAY NOT state {{AUTH_LIB}}, Cloudflare binding, or any third-party behavior as fact without opening the installed source and citing `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>`. Library docs, vendor README, and inferred behavior are NOT citations — only installed source counts. Uncited premises = spec rejected by reviewer.

<!-- nina:slot external-api.6 -->
13. **External-service integration surfaces require the integration-tester gate before reviewer.** Any diff touching `{{API_DIR}}/src/auth/**`, an `auth.api.*` callsite, Prisma Accelerate cache behavior, R2/KV/Queues/Durable Objects bindings, third-party HTTP, OR `{{PROVIDER_PKG}}/**` MUST pass the integration-tester before reviewer approval. Unit-test mocks honor the spec, not the live service — only the integration-tester catches drift.
