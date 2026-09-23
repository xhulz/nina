# Agent Router

Decides which subagent (or chain) to dispatch for a given task. Subagent definitions live in `.claude/agents/`.

<!-- nina:slot project.1 track-summary -->

---

## Decision tree

<!-- nina:slot project.2 decision-tree -->

---

## Track flow

<!-- nina:slot project.3 track-flow-diagram -->

`dba` and `integration-tester` may run in parallel after the implementer — both must approve before the reviewer can. `qa` runs after the reviewer approves.

### Milestone gate

```
… last sub-step: → reviewer → qa ─┬─▶ devops (preview deploy + smoke) ─┐
                                   │                                    ├─▶ milestone done
   (entire spec-SET like 6.* )  ───┴─▶ secops (whole-set audit) ────────┘
                                            │
                                            └─ BLOCKED (CRITICAL/HIGH) → architect / implementer → re-audit
```

**secops** is a MILESTONE gate, not a per-sub-step stage. When the LAST sub-step of a numbered set (`6.*`) or phase (one package's build-out) passes qa, dispatch **secops** to audit the whole assembled surface for cross-cutting security/privacy gaps. The set is not "done" until secops returns `SECURE`. Do NOT run secops per sub-step — only at set boundaries.

---

## Rules
<!-- nina:slot db.1 -->
<!-- nina:slot integrations.1 -->

### 2. Planner only for ambiguous, multi-step, or multi-package work
If the task fits in one head and lives in a single package, skip to architect (or implementer for trivial things). Don't dispatch planner for "change the button color" or "add a `label` field to `DestinationAccount`."

### 3. Architect output is a spec, not code
Architect produces a TS spec; implementer consumes the spec; they do not re-read the original user message.

### 4. Reviewer audits; QA runs tests
Reviewer runs `pnpm typecheck` / `pnpm lint` (and `pnpm build` for frontend) and verifies clean, confirms guardrails ran, but **does not run vitest**. QA runs vitest once after approval.

### 5. Pipeline is not sacred
If reviewer finds a design flaw, loop back to the architect. Don't paper over with implementation hacks.

### 6. Cloudflare plugin skills are part of the pipeline
The `cloudflare@cloudflare` plugin (user-scope) exposes retrieval-first skills. Subagents inherit them — invoke via the `Skill` tool. Mandatory triggers (mirrors CLAUDE.md):

| Diff touches… | Skill |
|---|---|
<!-- nina:slot edge-cf.1 -->
<!-- nina:slot edge-cf.2 -->
<!-- nina:slot edge-cf.3 -->
<!-- nina:slot edge-cf.4 -->
<!-- nina:slot frontend.1 -->
| **secops** auditing any milestone | **`security-audit`** (guidance mode — full-audit mode only on an explicit whole-tree request) |
<!-- nina:slot edge-cf.5 -->
<!-- nina:slot db.2 -->
<!-- nina:slot db.3 -->

The architect cites which skill informed the spec. The reviewer rejects a Workers/DO/Queues/wrangler-touching spec that doesn't cite a skill OR justify why it wasn't needed. Same rigor as the `node_modules:<line>` premise rule.
<!-- nina:slot edge-cf.6 -->

### 6b. Devops owns the deploy
Invoke **devops** after **qa PASS** on any step that changes a deployed surface (API, frontend, schema, wrangler config, secrets, bindings). It is the stage that executes Hard Rule #14 — the reviewer only checks that the spec *has* a preview-deploy plan. Skip it for steps that touch only tests, docs, or the harness. **Preview and staging it deploys on its own; production needs an explicit go from {{OWNER}} for that specific change.**
<!-- nina:slot frontend.2 -->

### 7. Write a pill on every loop-back or correction

When a stage loops back (qa → implementer on a test failure, reviewer rejects a diff, dba/secops blocks) **or** the user corrects something, the orchestrator distills the lesson into a pill under `.claude/pills/<role>/` (or `shared/` if it spans roles) so the responsible agent does not repeat it. This is a named step, not optional. Skip it only if the lesson is really a code convention (→ `patterns.md`/`CLAUDE.md`) or a library premise (→ `integrations/<lib>.md`) — those surfaces own it, and a recurring pill should eventually **graduate** there and be marked `retired`. If the lesson already has a pill, do **not** write a second one — increment that pill's `occurrences`, which is the counter that decides when a correction has recurred often enough to graduate into a rule. Each subagent already reads its own pills before acting, and `nina pills` checks that what was written is well formed and filed where its audience will actually read it (see `.claude/pills/README.md`).

---

## Parallelization

**The rule that decides everything here: a stage that only reads can always run beside another
stage that only reads. A stage that writes files owns those files alone.** Most of this pipeline is
read-only, so most of it can overlap — the default of running all nine stages nose-to-tail is a
habit, not a constraint.

Dispatch concurrent agents **in a single message with multiple Agent tool calls**. Separate messages
run them one after another and buy nothing.

### Run these in parallel

| Together | Why it is safe | What it buys |
|---|---|---|
| **`reviewer` ∥ `dba` ∥ `integration-tester`** after the implementer | all three are read-only + Bash | the two gates stop being a serial prefix to the review |
| **`reviewer` fanned out by dimension** — one per axis of risk the diff carries, such as tenant isolation, patterns and spec-scope | read-only; they never touch the same output | **the biggest single win.** One reviewer carrying ~15 checklists over a 500-line diff misses things; three narrow ones do not. Faster *and* better |
| **`architect` across the sibling specs of one milestone** (`retention-spec1..8`) | each writes its own file under `.claude/plans/specs/` | the specs share context, so designing them together is more coherent than one-at-a-time, and the whole milestone is specced in one pass |
| **`secops` ∥ `qa`** at the end of a milestone | secops is read-only by definition | removes the audit from the critical path |
| **`devops` ∥ `secops`** at the end of a milestone | devops only reads code; what it writes is a deploy target, not the tree | the audit and the preview deploy stop being sequential |
| **`Explore` fan-out** for "where does X live" | read-only | one search instead of every stage re-grepping the tree |

### Implementers: one per package, worktree-isolated, never the same file

Two implementers writing the same checkout will clobber each other. If you want them concurrent:

- Dispatch each with **`isolation: "worktree"`** so it gets its own git worktree.
- **One implementer per package, maximum.** `{{API_DIR}}` and `{{APP_DIR}}` are fine together; two inside
  `{{API_DIR}}` are not.
- Their specs' "Files to touch" lists must be **disjoint** — the planner marks the subtasks
  `PARALLEL-SAFE` only after checking that, and the architect's binding file list is what makes the
  check possible.
- The orchestrator sequences the merge. Never let two agents merge.

### Keep these serial

- **`qa`.** Vitest is ~2–3 GB per worker; concurrent invocations take the machine down. One run, at
  the end. This is not negotiable and is not a speed problem — the suites are seconds, except the
  `{{API_DIR}}` integration suite, which is slow for its own reasons (real DB).
- **The merge**, always.
- **A loop-back.** When a stage rejects, fix and re-run that stage; do not fan out around a failure.

### Right-sizing beats parallelism

Before parallelizing a chain, ask whether the chain should be that long at all. The
proportional-dispatch table above is worth more than any fan-out: a display change that takes
`implementer → reviewer` is already faster than the same change parallelized across five stages.

---

## What NOT to use subagents for

- Trivial edits (rename variable, fix typo, add a log line).
- Reading code to answer a user question.
- Running a single command.
- Pure research / exploration.

The subagent overhead isn't worth it for sub-5-minute tasks. Do it directly.

---

## Examples

| User request | Pipeline |
|---|---|
<!-- nina:slot project.5 dispatch-examples -->

---

## Quick triage

When dispatch is ambiguous, escalate one notch (heavier chain). The cost of an extra stage is low; the cost of skipping dba or integration-tester on a money-movement regression is a production incident with real money.
