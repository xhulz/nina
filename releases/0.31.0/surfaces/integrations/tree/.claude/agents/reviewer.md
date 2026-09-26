<!-- nina:slot integrations.1 -->
- **If an integration boundary was touched anywhere in the diff, or a new call into one was added: name `integration-tester` on your Gates line.** Also verify the architect's spec carries an **Integration premises** section, each premise with the evidence its kind requires. If the section is missing or uncited, REJECT upstream — do not approve a diff against an incomplete spec.

<!-- nina:slot integrations.3 -->
- The diff touches an integration boundary — **integration-tester also required**

<!-- nina:slot integrations.4 -->
- Leave `integration-tester` off your Gates line "because the unit tests pass." Unit tests honor the spec's mock, not the real dependency — only the integration-tester catches drift.

<!-- nina:slot integrations.5 -->
- Integration boundary touched and `integration-tester` not dispatched → name it on your Gates line; the orchestrator sends it.

<!-- nina:slot integrations.6 -->
- Spec touches an integration boundary but lacks the **Integration premises** section with citations → back to **architect** for spec amendment (do NOT approve the implementer's diff against an incomplete spec).

<!-- nina:slot integrations.7 -->
- **The one exception is a `live-api` contract-test case.** Its job is to catch the real service
  diverging from the mock, not to encode a mutation of code this project owns, so there is often no
  change on this side that turns it red. Name the divergence it would catch instead — "the provider
  renames a field the mock still sends" — and do not reject it for lacking a mutation: that test is
  integration-tester's gate, and rejecting it here would remove the one check that watches the mock.
