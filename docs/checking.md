# Checking a project

`check` and `where`: whether what a project declared about itself is true, and whether a thing an agent wants to write belongs in the harness at all. Read before touching `src/commands/check.mjs` or `src/commands/where.mjs`.

```bash
nina check --project ../thing               # is what this project declared about itself true?
```

`compose --check` answers *does the output match the layers*. `check` answers the question before
it: a surface that does not exist, a vocabulary entry nobody filled, an integration declared with no
doc behind it — all of those compose perfectly well and quietly produce a harness that says the
wrong thing.

`check` also asks for the documents the layers *read* but no layer *writes*. `.claude/architecture.md`
and the code map describe one system, so nothing could compose them — but nothing said so either, and
the core referenced them 21 times while a freshly composed project had none of them. The list is
derived rather than maintained: whatever the chosen layers reference in backticks and do not supply
is what the project owes, so a new reference added to the core starts being asked for on its own. It
found a leak the first time it ran — a surface hardcoding one project's integration doc.

`where` answers the question that comes before all of them: **an agent has something to write — does
it go here at all?** The composed tree carries no provenance, because `nina:slot` and `nina:requires`
are consumed at composition, so a line in a project's `.claude/agents/qa.md` cannot say whether it came
from the core or from one of seven surfaces. The `nina:generated` notice answers this for a file about
to be edited, which is the common case and the one it keeps. `where` exists for the three it cannot
reach: a path that is not composed yet, a path gated on a surface the project does not declare, and the
line between a file the project owns outright and a file the harness has never heard of — where no
notice exists on either side, because neither is composed.

```bash
nina where CLAUDE.md --project ../thing              # generated: 8 slots, 7 filled, project.8 open
nina where .claude/pills/qa/x.md --project ../thing  # yours — no compose writes a pill
nina where .claude/agents/solidity-dev.md            # gated (needs blockchain), so not on disk
```

It prints the file's notice by **calling `generatedNotice`**, not by restating it. Two copies of one
fact drifting apart has already shipped here once, and a command whose whole purpose is to be trusted
about where things go is the worst place for a second.

## Seeing the pipeline: `nina pipeline`

Opening a project, the pipeline was a graph, a router, ten specs and a table in `CLAUDE.md` to read before
anyone could say which stage came after which, on which model, with which skills. `nina pipeline` draws
it from what the project composed, and adds nothing of its own: every fact is already in a composed file,
and `nina check` already holds the specs to the graph.

```
  planner ─▶ architect ─▶ implementer ─▶ reviewer ─▶ qa ─┬─▶ devops ─▶ done   the change touches a deployed surface
                                                         ├─▶ secops ─▶ done   the last step of a milestone
                                                         └─▶ done             nothing to deploy

  gates on the way, when the diff calls for them
    implementer ─▶ dba ─▶ reviewer                   the diff touches the schema, a migration or a query
```

The shape is read off `.claude/graph.md`. The line is the one forward edge each stage takes with no
condition, from the first stage no forward edge reaches. A gate is a detour a stage of the line takes on a
condition, which hands the work on to the next stage of the line. The ends are where the line's last stage
sends work on a condition, followed to a terminal. Below them, what each stage sends back, to whom, on
which verdict and with how many rounds per issue. Then each stage with its model and effort level from its
spec's frontmatter, its skills as `nina check` reads them, and what it does in the graph's words, which are
shorter than a `description:` written for Claude Code to choose an agent by. An agent the project wrote for
itself is listed apart, since the graph does not route to it. Last, the task shapes of `CLAUDE.md`'s chain
table, each with the chain it takes.
