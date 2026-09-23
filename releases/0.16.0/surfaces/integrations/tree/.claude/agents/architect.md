<!-- nina:slot integrations.1 -->
12. **Integration premises (MANDATORY when an integration boundary is in scope)** — list every behavior of the dependency the implementation depends on. Each premise is a one-sentence claim followed by the evidence its kind requires:
    - `installed-library` → `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>`, from the version installed here
    - `live-api` → a contract-test case, or a response observed against the service and captured verbatim
    - `platform-binding` → behavior observed under the local emulator, plus the platform's installed types
    - or a `P<n>` reference into `.claude/integrations/<slug>.md`, which itself carries one of the above

    A premise without a citation is an **assumption**, not a fact. The integration-tester rejects the spec if a cited line does not validate at runtime, and rejects it outright if it lists uncited premises. When in doubt: read the source, or call the service and keep the response. Integration regressions ship precisely when a premise is assumed instead of cited.

    Also mark **"INTEGRATION-TESTER REQUIRED"** prominently at the top of the spec when this section is present.

<!-- nina:slot integrations.3 -->
- **For every integration behavior the implementation will rely on, get the evidence its kind requires** — open the installed source and cite `file:line`, or exercise the service and keep the response. Library docs and editor autocomplete are not citations. This is the single most important rule for avoiding integration regressions.

<!-- nina:slot integrations.4 -->
- **State an integration's behavior as fact without the evidence its kind requires.** Uncited premises are assumptions, and assumptions are what ship integration bugs to prod. If you cannot find the citation, the answer is to read more source or escalate — not to write the spec anyway.
