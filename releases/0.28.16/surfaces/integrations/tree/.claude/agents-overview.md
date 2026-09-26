<!-- nina:slot integrations.1 -->
- **Integration guardrail** → a spec describes behavior the implementer relies on, and unit tests with structural mocks honor the *spec*, not the dependency. The integration-tester runs the real thing: real flows for an installed library or a platform binding, and for a live API the contract suite against both the real client and the mock, so the two cannot diverge. Drift between assumption and reality is caught before deploy rather than after.

<!-- nina:slot integrations.2 -->
| **integration-tester** | Mandatory gate on any integration boundary; runs real flows, and for a `live-api` the contract suite against both implementations; verifies each cited premise; keeps `.claude/integrations/<slug>.md` current | `.claude/agents/integration-tester.md` |

<!-- nina:slot integrations.3 -->
- **`.claude/integrations/`** — one doc per integration, holding its verified premises
