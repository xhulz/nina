# Pipeline

<!-- nina:slot project.1 track-summary -->

<!-- nina:slot project.2 pipeline-diagram -->

The `reviewer` and every gate the diff triggers are read-only, so **dispatch them together in one
message** after the implementer rather than in sequence. The reviewer remains the gate — it does not
approve until the applicable guardrails have signed off. After approval, `qa` runs vitest once, on
its own. On a diff over ~200 lines, fan the reviewer out by dimension. Full rules:
`.claude/router.md` § *Parallelization*.

---

## Stage contracts

Each stage has: **Input** → what arrives, **Output** → the artifact handed on, **Tools** → what it may use, **Exit criteria** → what must be true before handing off.

---

### 1. Planner

- **Input:** user request, often ambiguous or multi-step.
- **Output:** ordered list of subtasks, each tagged with a 1-line goal + scope (S/M/L) + retrieval list + parallelization tag (`SEQUENTIAL` / `PARALLEL-SAFE`).
- **Tools:** Read, Grep, Glob, WebSearch, WebFetch. **No edits except planning artifacts.**
- **Exit criteria:** each subtask is small enough for an architect to design in a single pass.
- **Skip if:** task is already small, single-concern, and concrete.

### 2. Architect

- **Input:** one subtask from planner, or a well-scoped direct request.
- **Output:** technical spec — files to touch, function signatures, data flow, edge cases, tests to add, patterns to follow. Marks which gates in `.claude/graph.md` the change will trigger — the database gate if the schema or a query will be touched, the integration gate if an integration boundary will be — AND, for the latter, includes an **Integration premises** section: every behavior the implementation depends on, each carrying the evidence its kind requires — a `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>` citation, a contract-test case, an observed response, or a `P<n>` reference into `.claude/integrations/<slug>.md`. No premise without a citation.
- **Tools:** Read, Write, Edit, Grep, Glob, WebSearch, WebFetch. **No edits except spec files + `.claude/integrations/**`.**
- **Exit criteria:** implementer can code without re-planning AND the integration gate, where `.claude/graph.md` has one, can verify each premise / contract case without re-deriving it.

### 3. Implementer

- **Input:** architect's spec.
- **Output:** working TS code + tests. `pnpm typecheck`, `pnpm lint`, and (when frontend) `pnpm build` clean for the affected packages. Diff scoped to the spec. **Does NOT run vitest.**
- **Tools:** Read, Write, Edit, Glob, Grep, Bash.
- **Exit criteria:** typecheck/lint/build pass; no scope creep; if the database was touched, says so on first line; if an external service surface touched, says so.
<!-- nina:slot db.1 -->
<!-- nina:slot integrations.1 -->

### 5. Reviewer (gate before qa)

- **Input:** implementer's diff + all upstream artifacts.
- **Output:** approve, or request changes with `path:line` references.
- **Tools:** Read, Grep, Glob, Bash, WebFetch. **No edits. No vitest.**
- **Exit criteria:**
  - `pnpm typecheck`, `pnpm lint` pass; `pnpm build` when frontend touched.
  - Diff matches spec (reject scope creep).
  - `.claude/patterns.md` conventions followed (TSDoc, layering, naming, owner scoping).
<!-- nina:slot db.2 -->
<!-- nina:slot integrations.2 -->
  - No security / privacy regression (no PII in logs, no leaked secret, no query missing its owner scope).
<!-- nina:slot money.1 -->
  - **Preview-first deploy invariant:** a spec that culminates in prod deploy names a preview URL where smoke runs FIRST.

### 6. QA (test execution)

- **Input:** reviewer's APPROVED verdict + the implementer's touched-package list.
- **Output:** PASS (ready for deploy) or FAIL (loops back to implementer/architect).
- **Tools:** Read, Grep, Glob, Bash.
- Runs vitest **once**, per affected package, **sequentially** (configs enforce single-fork). Kills stray test processes at start and end. See `.claude/agents/qa.md`.

### 7. Devops (deploy)

- **Trigger:** qa PASS on a step that changes a deployed surface. Not for test-only, docs-only or harness-only steps.
- **Input:** qa PASS + the touched-package list + the architect spec's preview-deploy plan.
- **Output:** `DEPLOYED` (targets, migrations, the smoke it actually ran, the rollback) or `BLOCKED` (what stopped it, which stage owns the fix).
- **Tools:** Read, Grep, Glob, Bash, WebFetch. **No edits to code, tests or config.**
- **Checks:** clean rebuild of emitting packages; both targets when the API surface changed; `VITE_*` present at build time; `migrate deploy` against the intended database; secret parity; smoke against preview exercising the changed path; a named rollback.
- **Production:** never on its own initiative — an explicit go from {{OWNER}}, for that change.

---

## Handoff discipline

Each stage produces a **written artifact** — spec, diff, review comments. The next stage consumes the artifact, **not** the original user message. If you find yourself re-reading the original user message at stage 3, something is wrong at stage 2.

---

## Examples
<!-- nina:slot project.3 worked-example-a -->
<!-- nina:slot project.4 worked-example-b -->

### Example C — Trivial fix

User: "Fix the typo in the dashboard page title."

No planner, no architect. Implementer fixes, typecheck passes, reviewer verifies scope. → QA (only if a test file changed). Done.

---

## When the pipeline breaks

Where each failing verdict sends the work, and how many rounds it gets, is in `.claude/graph.md` —
the one place it is stated, composed for this project. This section used to restate it, and had
already drifted from it: it sent an architect back to the planner along an edge the graph did not
have. One thing the graph cannot express, so it stays here: a stage that hits something no spec
anticipated stops and says so. It does not guess.
