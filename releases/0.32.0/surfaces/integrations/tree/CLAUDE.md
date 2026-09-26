<!-- nina:slot integrations.1 -->
| **ANY integration surface** (the boundary module of a declared integration, or a new call into one) | architect cites a premise, with the evidence its kind requires, for every dependency behavior the code relies on; **+ integration-tester beside the reviewer** |

<!-- nina:slot integrations.3 -->
- **integration-tester** → mandatory gate on any integration boundary; runs the real dependency rather than a mock of it, and for a `live-api` runs the contract-test suite against both implementations so they cannot diverge; verifies every cited premise; keeps `.claude/integrations/<slug>.md` current

<!-- nina:slot integrations.4 -->
11. **Every integration has one boundary and one doc.** A dependency whose behavior you do not define — an installed library, a live third-party API, a platform binding — is reached through exactly ONE module, and nothing else speaks to it: no raw HTTP, SDK instance or binding handle in a route, service, queue consumer or scheduled handler. Each is declared in `.nina/profile.json` with its `kind` and `boundary`, and documented at `.claude/integrations/<slug>.md`. A `live-api` carries two implementations behind one interface — the real client and a deterministic mock — and one contract-test suite that BOTH must pass; a mock that is green while the real client is not is a lie, and a hard reject.

<!-- nina:slot integrations.5 -->
12. **A premise about an integration requires a citation, and the form depends on the kind.** The architect MAY NOT state a dependency's behavior as fact without evidence: for an `installed-library`, `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>` from the version actually installed here; for a `live-api`, a contract-test case or a response observed against the service and captured verbatim — observed by the integration-tester, before the spec when the design depends on it; for a `platform-binding`, behavior observed under the local emulator. Vendor docs, a README, a changelog and recall are NOT citations. An uncited premise is an assumption, and the spec is rejected by the reviewer.

<!-- nina:slot integrations.6 -->
13. **Integration boundaries require the integration-tester gate before qa.** Any diff touching a boundary module, or adding a call into one, MUST pass the integration-tester, which runs beside the reviewer, before `qa` goes out. Unit-test mocks honor the spec, not the dependency — a mock is green because we wrote it that way. Only a run against the real thing, or a contract suite both implementations pass, catches drift.

<!-- nina:slot integrations.7 -->
- **an integration boundary**: a call to an external service, or a webhook or callback from one
