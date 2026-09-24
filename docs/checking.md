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
