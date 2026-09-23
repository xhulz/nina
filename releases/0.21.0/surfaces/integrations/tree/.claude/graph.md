<!-- nina:slot integrations.1 -->
- `integration-tester` — gate: runs the real dependency when an integration boundary is touched

<!-- nina:slot integrations.2 -->
- `implementer` → `integration-tester` on `DIFF-READY` — the diff touches an integration boundary
- `integration-tester` → `reviewer` on `APPROVED`
- `integration-tester` → `architect` on `REJECTED` — a premise is wrong · max 2
- `integration-tester` → `implementer` on `REJECTED` — the premise holds and the code does not honor it · max 2
- `qa` → `integration-tester` on `FAIL` — the failure is the environment, not the code · max 2
