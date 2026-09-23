<!-- nina:slot external-api.1 -->

### 4b. Integration-tester (mandatory for external-service surfaces)

- **Trigger:** any diff touching {{AUTH_LIB}} (`{{API_DIR}}/src/auth/**`, `auth.api.*`), Prisma Accelerate cache behavior, R2/KV/Queues/Durable Objects bindings, any third-party HTTP, OR `{{PROVIDER_PKG}}/**` / a new {{PROVIDER}} client call.
- **Input:** architect spec (with **External library premises** section) + implementer diff + repo state.
- **Output:** approve or reject. Approve includes a verified-premise table (premise → verdict → citation). Reject identifies which premise/contract case failed and whether the fix is upstream (respec) or in code.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash. Edits scoped to integration/contract test dirs and `.claude/integrations/**`.
- **Checks:**
  - **Real services** ({{AUTH_LIB}}, Cloudflare bindings): run REAL flows (Miniflare + dev DB branch). Read `.claude/integrations/<lib>.md` and probe each premise.
  - **{{PROVIDER}}:** run the **contract-test suite** (`{{PROVIDER_PKG}}/test/contract/`) against **both** `{{PROVIDER_MOCK}}` and `{{PROVIDER_HTTP}}`. A mock that is green while the HTTP client is not is a lie. Confirm nothing calls {{PROVIDER}} outside `{{PROVIDER_PKG}}`.
  - Update `.claude/integrations/<lib>.md` (or `{{PROVIDER_DOC}}`) when new behavior is observed.
- **Position:** after implementer, in parallel with dba when both apply. Reviewer verifies both gates ran.

<!-- nina:slot external-api.2 -->
  - **If external-service surface touched → integration-tester approved.**

<!-- nina:slot external-api.3 -->
- **Integration-tester falsifies a premise / contract case** → loop back to architect (premise wrong → respec) OR implementer (premise right but code doesn't honor it). Update `.claude/integrations/<lib>.md` with the corrected premise.
