# Retrieval Map (RAG for workflow)

Which documents to pull into context for a given task type. Goal: **avoid loading all docs on every task** — that wastes tokens and crowds out the actual work.

This is the closest thing the harness has to RAG for development. Treat it as authoritative.

---

## Always loaded (by Claude Code itself)
- `CLAUDE.md` — loads automatically. Don't re-read.

## Pills (per-agent behavioral corrections — loaded by the agent itself)

`.claude/pills/<role>/*.md` + `.claude/pills/shared/*.md` hold hard-won corrections from past mistakes (a loop-back, a rejected diff, a blocked milestone, a user correction). **Each subagent reads its own pills before acting** (the instruction is in every `.claude/agents/<role>.md`). Distinct from the surfaces above: pills capture *agent behavior* ("the implementer did X wrong"), not codebase conventions (→ `patterns.md`) or library premises (→ `integrations/`). The orchestrator writes a pill on every loop-back or user correction. Graduation: when a pill becomes law, move it to `patterns.md`/`CLAUDE.md` and mark the pill `retired`. Format + guardrails: `.claude/pills/README.md`.
<!-- nina:slot integrations.1 -->
<!-- nina:slot project.1 integration-doc-list -->
<!-- nina:slot integrations.2 -->

## Code map (load first for file-location tasks)

**Rule:** Before grepping the repo to find which files participate in a domain, load `.claude/code-map.md`. Two layers:

- **`.claude/code-map.md`** — hand-curated. Purpose, invariants, the two money paths, what to reuse. **Read this one.**
- **`.claude/code-map.generated.md`** — the exhaustive mechanical inventory (every module, its exports, its test) plus the dead-export and untested-module reports. Produced by `pnpm code-map`. Go here when you need the full list.

`pnpm code-map:check` fails when the curated map has drifted from the tree, and a Stop hook runs it automatically. **A "does this helper already exist?" question is answered here, not by writing a second one.**

## Load on demand

### Task types

| Task type | Load these docs | Dispatch |
|---|---|---|
| New API endpoint | `.claude/architecture.md` § *API*, § *Layering*, `.claude/patterns.md` § *API conventions* | architect → implementer → reviewer → qa |
<!-- nina:slot db.1 -->
<!-- nina:slot db.2 -->
<!-- nina:slot edge-cf.1 -->
<!-- nina:slot integrations.3 -->
<!-- nina:slot edge-cf.2 -->
<!-- nina:slot money.1 -->
<!-- nina:slot frontend.1 -->
<!-- nina:slot frontend.2 -->
<!-- nina:slot edge-cf.3 -->
| Performance investigation | `.claude/architecture.md` § *Performance targets*, relevant source | architect → implementer |

### Meta tasks

**Before changing anything under `.claude/` or `CLAUDE.md`, settle where it goes.** Most of those
files are composed and cannot be changed from this project; the rest are yours outright, and the
first question is mechanical rather than a judgement call: **does the file carry `nina:generated`?**
`nina where <path>` answers that and the rest for any path — including a path that does not exist
yet, which is the case no file's own header can answer — and it prints the same sentence that file's
header carries rather than a second wording of it. Inside a generated file the second question is
the judgement one, and it is only about that case: is the wrong text **this project's fact**, which
belongs in a `project.N` slot, or **a rule for every project**, which cannot be changed from here?

| Task type | Load these docs | Dispatch |
|---|---|---|
| A rule an agent follows is wrong | `nina where <the composed file>` — it is a **request against the pinned core**, quoting file and line. It cannot be edited here | report it; it arrives back through `nina upgrade` |
| A number, path, command or provider in a composed file is wrong | `nina where <the composed file>` — it is **this project's fact**, so it belongs in the slot it names under `.nina/project/tree/` | whoever found it, now |
| A spec the harness should compose is not on disk | `nina where <the path>` — a file gated on a surface this project does not declare is **not missing**, it is switched off. Declaring the surface is a decision about the project, not a fix | whoever is asking why it is absent |
| A mistake just happened and should not happen twice | `.claude/pills/README.md` — a **pill** under `.claude/pills/<role>/`, written directly. Never an edit to the agent's spec | the orchestrator, on the loop-back |
| What a library actually does, proven at runtime | `.claude/integrations/<slug>.md` — yours to write, and the slug belongs in `.nina/profile.json` or nothing knows the doc exists | the integration gate, or whoever proved it |
| A plan for work in progress | `.claude/plans/**` — yours, and nothing composes it, ever | whoever is planning |
| Anything that is not one of the above | `nina where <the path>` — it will say "not harness", which is an answer: the file is ordinary project code and the harness has no opinion about it | whoever is editing it |
| New subagent role | `.claude/pipeline.md`, `.claude/router.md`, existing `.claude/agents/*.md` | human decision |
| Package / route / service / DO method added or removed | `.claude/code-map.md` — update the curated map, then run `pnpm code-map:check` | whoever shipped the change, at the close of the step |
| Update this map | this file | architect (light) → reviewer |

---

## How to scope loads

- **Load a section, not a full doc, when possible.** Architecture and patterns docs have headings; jump to the relevant one.
- **Don't preload.** Only read a doc when the task actually requires it.
- **Re-read existing code before editing it**, even if read this session — it may have changed.

---

## Anti-patterns

- ❌ Loading `.claude/architecture.md` in full for a 3-line bug fix.
- ❌ Loading `.claude/patterns.md` when the task is a pure design discussion (no code yet).
- ❌ Loading every subagent spec manually — they load automatically when dispatched via Agent.
- ❌ Re-reading `CLAUDE.md` after Claude Code has loaded it.
- ❌ Skipping the retrieval map and loading "everything just in case."

---

## When unsure

1. Read the **first 50 lines** of `.claude/architecture.md` (table of contents).
2. Identify the relevant section.
3. Read that section only.
4. If still unclear, escalate to the user — don't guess with more tokens.

---

## Updating this map

When a new kind of task appears that isn't in the table:
1. Add a row here first.
2. Commit the update alongside the change it describes.
3. Don't let the map rot — a stale retrieval map is worse than no map.
