<!-- nina:slot integrations.1 -->
- **Queue** (`{{API_DIR}}/src/queues/<q>.ts`) / **Webhook** (`{{API_DIR}}/src/routes/<source>-webhook.ts`): same discipline — validate the input, build deps, call one service function.

<!-- nina:slot integrations.2 -->
- **Every integration is reached through its boundary module.** Services import the boundary's typed interface; they never construct an HTTP client, an SDK instance or a binding handle themselves.

<!-- nina:slot integrations.3 -->

---

## Integrations (enforced by integration-tester + reviewer)

An **integration** is a dependency whose behavior this project does not define. Each one is declared in `.nina/profile.json` with a `kind`, and the kind decides what counts as evidence:

| kind | what it is | a premise is settled by |
|---|---|---|
| `installed-library` | code on disk under `node_modules` | `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>` |
| `live-api` | a third-party HTTP API | a contract-test case, or a response observed against the service and captured verbatim |
| `platform-binding` | a runtime the host provides | behavior observed under the local emulator, plus the platform's installed types |

- **One boundary per integration.** All access goes through the module named as its `boundary`. A service, route, queue consumer or scheduled handler that reaches the dependency directly is a hard reject: there is then no single place to mock it, retry it, log it, or fix it.
- **A `live-api` gets two implementations behind one interface** — the real client, and a deterministic in-memory mock. One **contract-test suite** exercises the interface and **BOTH** must pass it. The mock passing alone proves nothing about production; when the two disagree, the mock is wrong, never the other way round.
- **Validate responses at the boundary**, in both implementations, so drift in the dependency surfaces structurally instead of as a type error three layers downstream.
- **Typed errors at the boundary.** It maps the dependency's failures to this project's own error types; callers never handle a raw HTTP status or a vendor error code.

### Adding an integration

Four things, and none of them is optional:

1. **The doc** — `.claude/integrations/<slug>.md`, from `.claude/templates/integration.md`. It opens with a premise index, then one `## P<n>` section per premise: a one-sentence claim, and the evidence that settles it in the form its kind requires.
2. **The boundary** — one module, named in the profile entry. For a `live-api`: the interface, both implementations, and the contract suite.
3. **The profile entry** — `slug`, `name`, `kind`, `boundary` and `skill` in `.nina/profile.json`. This is what makes the integration visible to the gates; an integration that is not declared is not gated.
4. **The skill binding, when one exists.** If an installed skill covers this dependency, name it in the entry's `skill` field and add its row to the *Skills you MUST consult* table of every agent that touches the surface — and confirm `Skill` is in that agent's `tools:` list, which is an allowlist, not a hint. **If no installed skill covers it, bind none:** an invented binding is worse than none, because it reads as retrieval while being recall.

The **integration-tester** owns the doc: it creates it on first contact and appends a premise whenever it observes behavior the doc does not yet carry. The architect cites it, the implementer honors it, and the reviewer refuses a spec that touches the surface without it.

<!-- nina:slot integrations.4 -->
- **`live-api` integrations:** the contract-test suite for the boundary runs against BOTH implementations. Tests elsewhere inject the mock; the integration gate exercises the real service.
