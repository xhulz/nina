<!-- nina:slot integrations.2 -->
2. **Live APIs.** A third-party service you reach over the network — payments, messaging, automation, mail. *Their* API is the contract; we conform to it. There IS a real service to hit, so you run the **contract-test suite** for that boundary against **BOTH** the real client and the mock, and you check each `P<n>` premise in `.claude/integrations/<slug>.md` against what the service actually returns.

<!-- nina:slot integrations.3 -->
- The boundary module of any declared integration, or a new call into one

<!-- nina:slot integrations.6 -->
- For the integration you are gating: `.claude/integrations/<slug>.md`. Read EVERY premise it lists, not a sample — the one you skip is the one the diff depends on.

<!-- nina:slot integrations.7 -->

## You MUST — live APIs

- **Run the contract-test suite** for the boundary against **both** implementations. Every `P<n>` in the integration's doc maps to a case — verify every one the diff touches.
- **Never accept a green mock as proof.** If only the mock run is green you have verified nothing about production. Say so, and reject.
- **Confirm nothing reaches the service outside its boundary module.** Grep the diff and the tree for raw HTTP or client construction past the boundary. Any leak is a hard reject.
- **Confirm the boundary validates responses** in both implementations, so drift in the service surfaces structurally rather than as a type error three layers downstream.

<!-- nina:slot integrations.8 -->
- **Update `.claude/integrations/<slug>.md` when you observe new behavior**, with the evidence that settled it: a contract case, an observed response, or a source citation.
