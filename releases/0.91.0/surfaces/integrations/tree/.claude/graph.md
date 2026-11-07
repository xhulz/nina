<!-- nina:slot integrations.1 -->
- `integration-tester` — gate: runs the real dependency when the diff touches what its spec lists

<!-- nina:slot integrations.2 -->
- `implementer` → `integration-tester` on `DIFF-READY` — the diff touches what its spec lists
- `integration-tester` → `qa` on `APPROVED` — once the reviewer, and every other gate the diff went to, approved too
- `integration-tester` → `architect` on `REJECTED` — a premise is wrong · max 2
- `architect` → `integration-tester` on `BLOCKED` — a premise of a live service must be observed before the design can settle; the report goes back to the architect · max 2
- `integration-tester` → `implementer` on `REJECTED` — the premise holds and the code does not honor it · max 2
- `qa` → `integration-tester` on `FAIL` — the failure is the environment, not the code · max 2
