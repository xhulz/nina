<!-- nina:slot external-api.1 -->
- **If an external-library integration surface was touched anywhere in the diff (`{{API_DIR}}/src/auth/**`, an `auth.api.*` callsite, Prisma Accelerate cache, R2/KV/Queues/Durable Objects binding, third-party HTTP) OR `{{PROVIDER_PKG}}/**` was touched: confirm `integration-tester` ran and approved.** If not → dispatch `integration-tester` now, or request changes. No approval without integration-tester sign-off on these surfaces. Additionally verify the architect's spec contains an **External library premises** section: for real libraries, each premise must carry a `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>` citation; for {{PROVIDER}} (a live third-party API, not a library on disk), each premise references a `P-AS<n>` in `.claude/integrations/{{PROVIDER_DOC}}`, a contract-test case, or an observed sandbox response. If the section is missing or uncited, REJECT upstream — the spec is incomplete; do not approve the diff against an incomplete spec.

<!-- nina:slot external-api.2 -->
- The diff touches auth paths ({{AUTH_LIB}} config, `{{API_DIR}}/src/auth/**`, middleware) — **integration-tester also required**

<!-- nina:slot external-api.3 -->
- The diff touches an external-library integration surface (Prisma Accelerate cache, R2/KV/Queues/DO bindings, third-party HTTP) OR `{{PROVIDER_PKG}}/**` — **integration-tester also required**

<!-- nina:slot external-api.4 -->
- Skip the integration-tester check on external service changes "because the unit tests pass." Unit tests honor the spec's mock, not the real library or the published contract — only the integration-tester catches drift.

<!-- nina:slot external-api.5 -->
- External-library / {{PROVIDER}} surface touched but integration-tester missed → dispatch **integration-tester** now.

<!-- nina:slot external-api.6 -->
- Spec touches an external-service surface but lacks the **External library premises** section with citations (or contract-case references for {{PROVIDER}}) → back to **architect** for spec amendment (do NOT approve the implementer's diff against an incomplete spec).
