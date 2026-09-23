<!-- nina:slot integrations.1 -->

### 4b. Integration-tester (mandatory for integration boundaries)

- **Trigger:** any diff touching the boundary module of a declared integration, or adding a call into one.
- **Input:** architect spec (with its **Integration premises** section) + implementer diff + repo state.
- **Output:** approve or reject. Approve includes a verified-premise table (premise → verdict → citation). Reject identifies which premise or contract case failed, and whether the fix is upstream (respec) or in code.
- **Tools:** Read, Write, Edit, Glob, Grep, Bash. Edits scoped to integration/contract test dirs and `.claude/integrations/**`.
- **Checks:**
  - **`installed-library` / `platform-binding`:** run the real flow against the real dependency. Read `.claude/integrations/<slug>.md` and probe each premise it lists.
  - **`live-api`:** run the **contract-test suite** for that boundary against **both** implementations. A mock that is green while the real client is not is a lie. Confirm nothing reaches the service outside its boundary module.
  - Update `.claude/integrations/<slug>.md` when new behavior is observed.
- **Position:** after implementer, in parallel with dba when both apply. Reviewer verifies both gates ran.

<!-- nina:slot integrations.2 -->
  - **If an integration boundary was touched → integration-tester approved.**

<!-- nina:slot integrations.3 -->
- **Integration-tester falsifies a premise or contract case** → loop back to architect (premise wrong → respec) OR implementer (premise right but code doesn't honor it). Update `.claude/integrations/<slug>.md` with the corrected premise.
