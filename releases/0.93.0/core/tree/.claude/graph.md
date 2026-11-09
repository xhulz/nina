# Pipeline graph

The one place this project's stages, and the edges between them, are stated. Every other document that
routes work — `CLAUDE.md`, `router.md`, `pipeline.md`, each role's loop-back rules — describes this
graph; where one of them disagrees with it, this file is right and the other is a defect to report
(Hard Rule #17). It is composed for this project, so a stage this project does not have is not in it,
and no edge points at one.

`nina check` validates it: every stage has a spec, every spec is a stage, every edge leaves on a verdict
its stage can actually emit, every verdict a stage can emit goes somewhere, and every loop-back edge has
a cap.

## Stages

- `planner` — decomposes ambiguous or multi-step work into ordered steps
- `architect` — designs the approach and writes the spec, with cited premises
- `design-reviewer` — reads the spec before any code, when the design is the question
- `implementer` — writes code and tests to the spec; <!-- nina:pace full -->never runs the tests<!-- /nina:pace --><!-- nina:pace fast -->runs only the tests it wrote<!-- /nina:pace -->
<!-- nina:slot db.1 -->
<!-- nina:slot integrations.1 -->
<!-- nina:slot blockchain.1 -->
- `reviewer` — audits the diff against the spec, and names every gate the diff triggers
- `qa` — runs the tests, once, <!-- nina:pace full -->at the end<!-- /nina:pace --><!-- nina:pace fast -->after a spec's last step and before any deploy<!-- /nina:pace -->
- `devops` — deploys to preview and smokes it; production only on the owner's explicit go
- `secops` — the security gate, once per milestone

The two terminals are `done` and `human`. `human` is the owner: a decision nobody in the pipeline can
make, or a loop that has run out of rounds.

## Edges

One per line: the stage, where its work goes, on which verdict, and when. A loop-back edge ends with
its **cap** — how many times the SAME issue may travel it, the issue being what the stage names on the
`ISSUES` line under its verdict. <!-- nina:pace full -->When the next round would exceed the cap,
the orchestrator stops and hands the owner the reports from every round, instead of dispatching again:
a third attempt at a fix that failed twice is rarely different from the second, and each round costs
minutes to hours.<!-- /nina:pace --><!-- nina:pace fast -->When the same issue comes back past the cap, the
orchestrator does not dispatch again. A review's finding — the reviewer's or the design-reviewer's — is
settled as a follow-up: the reviewer that raised it is resumed, and passes with the issue listed. Anything
else — a hole in security, isolation or data, a failing test, a failed deploy or gate run — goes to the
owner with the reports from every round (Hard Rule #20).<!-- /nina:pace --> A different issue on the same edge starts its own count. Where the project wires the loop
gate, the dispatch past a cap waits for the owner to confirm it; `router.md` says how rounds are counted.

- `planner` → `architect` on `PLAN-READY`
- `planner` → `human` on `BLOCKED` — the work cannot be decomposed without an answer
- `architect` → `implementer` on `SPEC-READY`
- `architect` → `design-reviewer` on `SPEC-READY` — the design is the question: it builds a check, scanner, parser or filter, or picks a mechanism nothing here has run
- `architect` → `human` on `BLOCKED` — an unverifiable premise or a missing decision
- `architect` → `planner` on `BLOCKED` — the plan itself is wrong, not the design · max 1
- `design-reviewer` → `implementer` on `APPROVED`
- `design-reviewer` → `architect` on `REJECTED` — a design flaw, found before any code · max {{LOOP_CAP}}
- `implementer` → `reviewer` on `DIFF-READY`
- `implementer` → `architect` on `BLOCKED` — the spec is wrong, needs a file it does not list, or asks one run for more files or lines than a step may write, or a step of source half again its forecast · max {{LOOP_CAP}}
- `implementer` → `planner` on `BLOCKED` — the spec is too large for one step · max 1
<!-- nina:slot db.2 -->
<!-- nina:slot integrations.2 -->
<!-- nina:slot blockchain.2 -->
<!-- nina:slot money.1 -->
- `reviewer` → `qa` on `APPROVED`<!-- nina:pace fast --> — a spec's last step, or a step that goes to deploy<!-- /nina:pace -->
- `reviewer` → `done` on `APPROVED` — a spike, or a chain with no architect whose change no test covers<!-- nina:pace fast -->, or a step before its spec's last: the next step goes out<!-- /nina:pace -->
- `reviewer` → `implementer` on `REJECTED` — an implementation bug · max {{LOOP_CAP}}
- `reviewer` → `architect` on `REJECTED` — a design flaw, or no preview-deploy plan · max {{LOOP_CAP}}
- `qa` → `devops` on `PASS` — the change touches a deployed surface
- `qa` → `secops` on `PASS` — the last step of a milestone
- `qa` → `done` on `PASS` — nothing to deploy, or nowhere yet
- `qa` → `implementer` on `FAIL` — a test fails, the run exits non-zero, or a "pre-existing" failure does not reproduce · max {{LOOP_CAP}}
- `qa` → `architect` on `FAIL` — the test is right and the spec was wrong · max {{LOOP_CAP}}
- `devops` → `done` on `DEPLOYED` — preview is green; production waits for the owner
- `devops` → `implementer` on `BLOCKED` — the deploy failed because the code is wrong · max {{LOOP_CAP}}
- `devops` → `architect` on `BLOCKED` — the spec has no workable deploy plan · max {{LOOP_CAP}}
- `secops` → `done` on `SECURE`
- `secops` → `implementer` on `BLOCKED` — a CRITICAL or HIGH that is a bug · max {{LOOP_CAP}}
- `secops` → `architect` on `BLOCKED` — a CRITICAL or HIGH that is a design flaw · max {{LOOP_CAP}}

## Concurrency

Stages that only read may run together: after the implementer, the `reviewer` and every gate the diff
triggers go out in one message — a gate that will delete rows in a shared database writes, and waits for the database
gate — and `qa` goes out once each of them has approved<!-- nina:pace fast --> a spec's last step<!-- /nina:pace -->; at a milestone's end,
`secops` runs beside `devops`, after the last `qa` passed.
`qa` always runs alone. These may run as several agents at once, each on its own share of the work:
- `architect` × many — the sibling specs of one milestone, each its own spec
- `implementer` × many — work that shares no file and builds on nothing the other writes: side by side in different packages, each in its own worktree within one
- `reviewer` × many — one per axis of risk the diff carries, for a diff over ~200 lines
