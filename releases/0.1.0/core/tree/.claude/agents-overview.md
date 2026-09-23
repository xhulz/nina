# Agent Pipeline — Overview

<!-- nina:slot project.1 -->

The pipeline separates thinking from execution, execution from verification, and gates the highest-blast-radius surfaces (the database, the runtime behavior of external libraries, and the {{PROVIDER}} money-movement contract) behind mandatory specialists.

---

## Why a pipeline?

- **Narrow tool surface per stage** → fewer accidents, less token waste.
- **Explicit handoffs** → drift between "what we intended" and "what we built" gets caught at the next stage instead of in production.
<!-- nina:slot db.1 -->
<!-- nina:slot external-api.1 -->

---

<!-- nina:slot project.2 -->

| Role | Purpose | Spec |
|---|---|---|
| **planner** | Decompose ambiguous work into concrete, ordered subtasks | `.claude/agents/planner.md` |
| **architect** | Design the technical approach before code is written; cite `node_modules:<line>` premises for every external-library behavior the spec depends on | `.claude/agents/architect.md` |
| **implementer** | Write code following the architect's spec, honoring every cited premise | `.claude/agents/implementer.md` |
<!-- nina:slot db.2 -->
<!-- nina:slot external-api.2 -->
| **reviewer** | Verify the diff: patterns, bugs, security; confirm guardrails ran; gate before qa | `.claude/agents/reviewer.md` |
| **qa** | Run vitest once at the END of the pipeline (after reviewer approves) for the affected packages; loop back on failures | `.claude/agents/qa.md` |
| **devops** | Owns qa PASS → running where someone can use it: clean build, both targets, migrations, secret parity, smoke against preview, rollback. Prod needs an explicit go | `.claude/agents/devops.md` |
| **secops** | **Milestone gate.** Audit the whole assembled surface of a completed spec-SET (`6.*`, `{{PROVIDER_PKG}}`) for cross-cutting security/privacy gaps; CRITICAL/HIGH blocks the milestone | `.claude/agents/secops.md` |

---

## Flow at a glance

<!-- nina:slot project.3 -->

Everything between the implementer and qa is **read-only**, so it goes out in one dispatch rather
than three: `reviewer`, plus `dba` when Prisma was touched, plus `integration-tester` when an
external service was. On a large diff the reviewer itself fans out by dimension — money invariants,
tenant isolation + LGPD, patterns + spec-scope — which is both faster and more thorough than one
agent carrying fifteen checklists. The reviewer is still the gate: it refuses approval until the
applicable guardrails have signed off. After approval, **qa** runs the suite once, alone.

Concurrent **implementers** are the one write-side exception and need `isolation: "worktree"`, one
per package, with disjoint file lists. See `.claude/router.md` § *Parallelization*.

**devops** runs after every qa PASS that changes a deployed surface: it builds clean, deploys both targets, applies migrations, smokes against **preview** — never prod first — and names the rollback. Production waits for an explicit go from {{OWNER}}.

**secops** runs once at the END of a numbered spec-SET / phase (not per sub-step): after the last sub-step's qa, it audits the whole assembled surface as an attacker + LGPD auditor. A `BLOCKED` verdict (CRITICAL/HIGH) loops back to architect/implementer; the milestone is not done until secops returns `SECURE`.

---

## Related docs

- **`.claude/pipeline.md`** — full flow, stage contracts, examples
- **`.claude/router.md`** — which pipeline to use for which task type
- **`.claude/retrieval.md`** — which docs each stage should load
- **`.claude/patterns.md`** — conventions every stage enforces
<!-- nina:slot external-api.3 -->
- **`CLAUDE.md`** — top-level rules (mandatory pipeline, hard rules)
