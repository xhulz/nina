<!-- nina:slot integrations.1 -->
- **If an integration boundary was touched anywhere in the diff, or a new call into one was added: confirm `integration-tester` ran and approved.** If not → dispatch it now, or request changes. Additionally verify the architect's spec carries an **Integration premises** section, each premise with the evidence its kind requires. If the section is missing or uncited, REJECT upstream — do not approve a diff against an incomplete spec.

<!-- nina:slot integrations.3 -->
- The diff touches an integration boundary — **integration-tester also required**

<!-- nina:slot integrations.4 -->
- Skip the integration-tester check "because the unit tests pass." Unit tests honor the spec's mock, not the real dependency — only the integration-tester catches drift.

<!-- nina:slot integrations.5 -->
- Integration boundary touched but integration-tester missed → dispatch **integration-tester** now.

<!-- nina:slot integrations.6 -->
- Spec touches an integration boundary but lacks the **Integration premises** section with citations → back to **architect** for spec amendment (do NOT approve the implementer's diff against an incomplete spec).
