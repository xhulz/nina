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

| Task type | Load these docs | Dispatch |
|---|---|---|
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
