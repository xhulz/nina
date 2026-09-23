<!-- nina:slot project.1 title -->

<!-- nina:slot project.2 mission -->

<!-- nina:slot project.3 stack -->
<!-- nina:slot edge-cf.1 -->

> **A subagent can only invoke a skill if `Skill` is in its `tools:` list.** That field is an allowlist, not a hint: for the harness's first three months it omitted `Skill` on all nine roles, so every mandatory-skill rule here was unenforceable and the measured invocation count was 2 in 743 runs — both from built-in agents that carry the full tool set. Any new role that binds a skill must grant `Skill`. The `tools:` field is read when the agent is registered, so a change to it needs a new session; the spec body is re-read on every dispatch.

Mandatory triggers:

| When you are about to… | Invoke skill | Why |
|---|---|---|
<!-- nina:slot edge-cf.2 -->
<!-- nina:slot edge-cf.3 -->
<!-- nina:slot edge-cf.4 -->
<!-- nina:slot edge-cf.5 -->
<!-- nina:slot frontend.1 -->
| Run the **secops** milestone gate | `security-audit` | the attack-class corpus; guidance mode — its full six-phase workflow is for an explicit whole-tree audit only |
<!-- nina:slot edge-cf.6 -->
<!-- nina:slot db.1 -->
<!-- nina:slot db.2 -->

**Each agent spec now carries its own binding table** (`.claude/agents/<role>.md` § *Skills you MUST consult*), because a rule that lives only here was invoked 2 times in 743 subagent runs. `qa` and `planner` have no skill bound — none of the installed skills covers vitest or decomposition, and an invented binding is worse than none.
<!-- nina:slot edge-cf.7 -->

Reviewer rejects any architect spec that touches the platform runtime or its deploy config without citing which skill it consulted, OR explaining why the skill was not needed. Same standard as the premise rule below: retrieval beats recall.

## Where things live
- Full architecture → `.claude/architecture.md`
- Code conventions → `.claude/patterns.md`
- Agent dispatch rules → `.claude/router.md`
- Which docs to load per task → `.claude/retrieval.md`
- Agent pipeline overview → `.claude/agents-overview.md`
- Stage contracts + examples → `.claude/pipeline.md`
- Subagent role specs → `.claude/agents/` (dispatchable via Agent tool) — **generated.**
  They are composed by `nina compose` from the harness core, the surfaces this project
  declares in `.nina/profile.json`, and its own overrides in `.nina/project/tree/`.
  Edit those, not the output: a hand edit here is reported as drift by `pnpm harness:check`
  and is overwritten by the next compose.
<!-- nina:slot project.4 product-docs -->

## ⚠️ Agent pipeline — MANDATORY

> **Dispatch the subagent chain that fits the task's size and blast radius — before executing anything non-trivial.**
> The pipeline is **proportional, not one-size-fits-all.** Money movement, the database, auth, integration boundaries, and substantial multi-file features get the full chain. Small read-only / display / UI-copy changes get a light chain — or a direct edit. **Under-gating a money/database/auth/integration change is a protocol violation. Over-gating a one-file label or list change wastes hours — that is also a failure.**

### Procedure — follow this every time

1. **Classify the task** using the table below *before* touching any file.
2. **Dispatch the first subagent** in the required chain via the Agent tool.
3. Each stage hands off a written artifact (spec / diff / review) to the next.
4. **Run the read-only stages concurrently.** A stage that only reads can run beside any other stage that only reads, so `reviewer`, `dba` and `integration-tester` go out together after the implementer — in ONE message with multiple Agent calls — and `secops` runs alongside `qa` at a milestone's end. For a diff over ~200 lines, fan the reviewer out by dimension — one reviewer per axis of risk the diff actually carries — instead of asking one agent to carry every checklist. Concurrent **implementers** are the exception: they write, so each needs `isolation: "worktree"`, one per package, with disjoint file lists. `qa` is always alone (vitest memory). Full rules: `.claude/router.md` § *Parallelization*.
5. The **reviewer** must verify every required stage ran — including the database gate if the schema or a query was touched — before approving.
6. **Honor the planner's `ONE-SPEC` / `ONE-REVIEW` grouping.** Sibling steps that change no observable behavior on their own get **one** architect spec and **one** reviewer pass over the combined diff, while still being implemented one step at a time. Small steps are good; eight full pipelines to ship one feature are not. This never relaxes a gate — dba / integration-tester / secops fire on the surface touched, however the specs were grouped.
7. **Right-size before dispatching.** Match the chain to blast radius (see table). A change that touches no money path, no database, no auth or integration surface, and ≤2 files takes the light chain — or a direct edit when a subagent adds nothing (a label, a copy tweak, a list render). Do NOT run planner/architect/secops on that. The money/database/auth/integration gates below are never optional.
8. **At the END of a spec-SET / milestone** (e.g. all of `6.*`), after the last sub-step's qa, dispatch **secops**. The milestone is not done until secops returns `SECURE`. This is a milestone gate, NOT a per-sub-step stage. **Scope secops to the milestone's diff by default.** A whole-tree sweep surfaces pre-existing debt mid-task and causes scope-creep — run it ONLY when explicitly requested, as a deliberate choice, never as the default.

### Required chain by task shape

| Task shape | Required dispatch |
|---|---|
| Question / exploration / Q&A | none — answer directly |
| Trivial edit (rename, typo, 1-line log fix) | none — edit directly |
| **Small read-only / display / UI-copy change** (≤2 files, no money path, no database, no auth or integration boundary) | **implementer → reviewer** — or a direct edit if a subagent adds no value; qa runs ONLY the affected test file. No planner, no secops. |
| Single-file bug fix (TS) | **implementer → reviewer → qa** |
| Refactor TS (no new behavior) | **architect → implementer → reviewer → qa** |
| New TS feature / multi-file change (money path, schema, auth, or ≥3 files with logic) | **planner → architect → implementer → reviewer → qa** |
<!-- nina:slot db.3 -->
<!-- nina:slot integrations.1 -->
| **ANY step that changes a deployed surface** (API, frontend, schema, deploy config, secrets, bindings) | **+ devops after qa** — preview deploy + smoke; prod only on an explicit go |
<!-- nina:slot frontend.2 -->
| **END of a spec-SET / milestone** (a numbered set like `6.*`, or a phase like one package's build-out) | **+ secops after the last sub-step's qa** — milestone security gate; `SECURE` required before the milestone is declared done |

**Test execution policy:** vitest is **only** invoked by the **qa** stage, which runs once at the end of the pipeline (after reviewer approves). Implementer writes tests but does NOT execute them. Reviewer does NOT run tests. This prevents the workspace-machine memory blowups from concurrent vitest invocations (vitest is ~2–3 GB per worker). Configs enforce single-fork; the root `pnpm test` uses `turbo run test --concurrency=1`.

**Test scoping (speed — this is the single biggest time sink).** qa runs ONLY the test files / packages the diff actually touches during the build→fix loop — never the full suite per cycle. The `{{API_DIR}}` integration suite hits a real Accelerate DB via real magic-link flows and takes **~18 min** (and is flaky under load). Run it targeted per file while iterating; run the **full** package suite exactly ONCE, right before opening the PR / merging, as the final gate. Vitest stays single-fork and non-concurrent.

### If you are uncertain which chain applies
→ If the doubt is whether a **money / database / auth / integration** surface is touched → treat it as the heavier shape and gate it. If the task is clearly none of those and the only question is "how much ceremony" → take the **lighter** chain; an extra planner/secops pass on a display change costs hours, not minutes.

<!-- nina:slot project.5 roles-heading -->

- **planner** → decompose ambiguous or multi-step tasks into ordered subtasks
- **architect** → design the TS technical approach AND cite external-library premises (`node_modules/.pnpm/<lib>/.../<file>:<line>`); write a spec before code exists
- **implementer** → write TS code AND test files strictly to spec; runs typecheck/lint/build only (NOT vitest)
<!-- nina:slot db.4 -->
<!-- nina:slot integrations.3 -->
- **reviewer** → verify diff matches spec, run typecheck/lint/build (NOT vitest), confirm dba and integration-tester ran when applicable, confirm spec has a preview-deploy plan
- **qa** → runs vitest once at the END of the pipeline (after reviewer approves) for the affected packages; loops back to implementer on failures
- **devops** → **deploy owner.** Runs after **qa PASS** on any step that changes a deployed surface. Staging FE goes to Pages `--branch staging` (a preview deploy); `--branch main` is production and needs an explicit go. Smokes the deployed preview for a blank page and a clean console — judging whether the screen is *right* is the reviewer's job, not his. Executes Hard Rule #14: clean build, both targets (staging Worker + Pages), build-time env, migrations in order against the right DB, secret parity, **smoke against preview**, named rollback. Deploys preview/staging on its own; **a production deploy requires an explicit go from {{OWNER}} for that change.** Read-only on code — a failed deploy caused by bad code loops back, it does not get patched here.
- **secops** → **milestone security gate.** Runs once at the END of a completed spec-SET (a numbered milestone like `6.*`, or a phase like one package's build-out), after the last sub-step's qa — NOT per sub-step. Audits as an attacker and a privacy auditor (auth/session, tenant isolation, secrets and config exposure, PII leakage, abuse of any irreversible operation and its idempotency seams, injection/SSRF, dependency and binding posture). **Scoped to the milestone diff by default; a whole-tree sweep runs only on explicit request** (it surfaces pre-existing debt mid-task → scope-creep). Read-only; CRITICAL/HIGH findings in the milestone's own surface BLOCK it and loop back until re-audited.

<!-- nina:slot project.6 doc-pointers -->

## Hard rules (non-negotiable)

1. **Run the subagent chain proportional to the task (see the pipeline table).** Under-gating a money-movement, database, auth, or integration change is a protocol violation — those gates are never skipped, and when uncertain whether such a surface is touched, gate it. But small read-only / display / UI-copy changes (≤2 files, none of those surfaces) take the light chain or a direct edit — over-gating them wastes hours and is also a failure.
<!-- nina:slot db.5 -->
<!-- nina:slot money.1 -->
<!-- nina:slot money.2 -->
<!-- nina:slot money.3 -->
<!-- nina:slot db.6 -->
<!-- nina:slot db.7 -->
<!-- nina:slot pii.1 -->
9. **TSDoc is mandatory on every TS declaration** (function, type, interface, class, method, enum) — exported or not. Enforced in review.
<!-- nina:slot edge-cf.8 -->
<!-- nina:slot integrations.4 -->
<!-- nina:slot integrations.5 -->
<!-- nina:slot integrations.6 -->
14. **Preview-first deploy. Smoke runs against preview, NEVER prod first.** The **devops** stage owns executing this; the reviewer only verifies the plan exists. Any change that culminates in a production deploy must name a preview URL (a preview deployment for `{{APP_DIR}}`; a staging route for the API) in the architect's spec. Smoke runs against preview FIRST. A spec without a preview-deploy plan is rejected by the reviewer.
15. **Relative imports use the `.js` extension in `.ts`/`.tsx` source — this is intentional ESM, NOT a mistake.** `import { x } from './client.js'` (never `'./client'` or `'./client.ts'`). TypeScript does not rewrite specifiers; emitting packages ({{EMITTING_PKGS}}) ship real `dist/*.js`, so the `.js` form is the only one that resolves at runtime, and the bundlers map it back to `.ts` source transparently. Stripping or `.ts`-ifying the extension breaks the build — do not "fix" it. Full rationale: `.claude/patterns.md` § *Relative imports carry a `.js` extension*.

## Common commands

<!-- nina:slot project.7 common-commands -->

## When in doubt
Consult `.claude/retrieval.md` to decide which docs to load before acting.
