<!-- nina:slot external-api.1 -->
- **Integration-tester guardrail** → the spec describes external behavior the implementer relies on. Unit tests with structural mocks honor the spec, NOT the dependency. For real services ({{AUTH_LIB}}, Cloudflare bindings, the {{PROVIDER}} sandbox) the integration-tester runs real flows; for **{{PROVIDER}}** it runs the **contract-test suite** against BOTH the mock and the HTTP client so they cannot diverge. Either way, drift between assumption and reality is caught before deploy.

<!-- nina:slot external-api.2 -->
| **integration-tester** | Mandatory gate on external-service (incl. {{PROVIDER}}) surfaces; real flows against real services ({{AUTH_LIB}}, Cloudflare bindings, {{PROVIDER}} sandbox) plus the {{PROVIDER}} contract-test suite; verifies each cited premise; updates `.claude/integrations/<lib>.md` | `.claude/agents/integration-tester.md` |

<!-- nina:slot external-api.3 -->
- **`.claude/integrations/`** — per-library verified premises + the {{PROVIDER}} contract notes
