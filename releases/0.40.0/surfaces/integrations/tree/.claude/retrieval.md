<!-- nina:slot integrations.1 -->

## Integration docs (load whenever an integration is touched)

`.claude/integrations/<slug>.md` holds the verified premises for one integration. The architect MUST cite premises from it — or add new ones, carrying the evidence the integration's kind requires — in any spec that touches the boundary. The integration-tester probes each cited premise before `qa` goes out.

This project's integrations:

<!-- nina:slot integrations.2 -->

The integration-tester owns these docs. It creates one on first contact with a dependency and appends a premise whenever it observes behavior the doc does not yet carry, written against the version actually installed here or the response actually observed — never against the vendor's documentation.

Read the doc's index and the premise sections your task cites. **Not the whole file:** an integration doc for a large dependency runs to thousands of lines, and reading it end to end is one of the biggest time sinks in this pipeline.

<!-- nina:slot integrations.3 -->
| Integration boundary change | `.claude/integrations/<slug>.md`, and the boundary module named in the profile | architect (cites premises) → implementer → reviewer + **integration-tester** → qa |
