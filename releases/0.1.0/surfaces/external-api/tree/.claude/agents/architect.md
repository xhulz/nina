<!-- nina:slot external-api.1 -->
12. **External library premises (MANDATORY for integration surfaces)** — if the spec touches {{AUTH_LIB}}, a Cloudflare binding (R2/KV/Queues/Durable Objects), Prisma Accelerate cache behavior, or any third-party HTTP, you MUST include a section listing every behavior of the external library the implementation depends on. Each premise is a one-sentence claim followed by a **citation** in one of two forms:
    - `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>` pointing into the actual installed source, OR
    - a reference to a `P<n>` premise in `.claude/integrations/<lib>.md` (which itself carries a `node_modules` citation).

    A premise without a citation is an **assumption**, not a fact. The integration-tester will reject the spec if any cited line does not validate at runtime, and will reject the spec entirely if it lists uncited premises. When in doubt: read the source. Integration regressions ship to prod precisely when an external-library premise is assumed instead of cited — never assume a library's behavior you have not opened.

    Also mark **"INTEGRATION-TESTER REQUIRED"** prominently at the top of the spec when this section is present.

<!-- nina:slot external-api.2 -->
13. **{{PROVIDER}} surface flag** — if the spec touches `{{PROVIDER_PKG}}/**` or introduces a new {{PROVIDER}} client call, mark **"INTEGRATION-TESTER REQUIRED"** at the top. **{{PROVIDER}} is a real, live provider and its API is the contract — theirs, not ours.** Cite each premise as a `P-AS<n>` in `.claude/integrations/{{PROVIDER_DOC}}`, a contract-test case in `{{PROVIDER_PKG}}/test/contract/`, or an observed sandbox response. Inference and vendor docs are not evidence. Both `{{PROVIDER_MOCK}}` and `{{PROVIDER_HTTP}}` must satisfy every case you reference. Confirm all access goes through the `{{PROVIDER_PKG_NAME}}` typed interface, that nothing else speaks HTTP to {{PROVIDER}}, and that reais⇄centavos conversion stays inside the package.

<!-- nina:slot external-api.3 -->
- **For every external-library behavior the implementation will depend on, OPEN the installed source under `node_modules/.pnpm/<lib>@<version>/...` and cite the file:line that proves the behavior.** This is the single most important rule for avoiding integration regressions. Library docs and editor-autocomplete guesses are not citations — only `node_modules` source counts. For {{PROVIDER}} surfaces, the equivalent citation is a `P-AS<n>` premise, a contract-test case, or an observed sandbox response.

<!-- nina:slot external-api.4 -->
- **State external-library behavior as fact without a `node_modules:<line>` citation** (or a contract-test case for {{PROVIDER}} surfaces). Uncited premises are assumptions, and assumptions are what ship money-routing bugs to prod. If you cannot find the citation, the answer is to read more source or escalate — not to write the spec anyway.
