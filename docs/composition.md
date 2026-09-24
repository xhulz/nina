# Composition: what keeps it honest, and how a rule changes

What must hold of every composed project, how that is tested, and how a rule is changed — in its layer, never in the output. Read before touching `src/commands/compose.mjs`, the notice `where` prints, `src/guard.mjs`, `src/tools.mjs`, `scripts/agent-tools-check.mjs`, a layer, or `scripts/compose-test.mjs`.

## The rule that keeps this honest

**The composed output must be byte-identical to what is running.** The harness was extracted
by slicing a live project, never by rewriting it, and every line was assigned to exactly one
layer. That is the whole proof that nothing was lost or quietly reworded — and it is the
reason a line cannot simply be edited to read better. Rewriting for clarity belongs to a
later phase, against a second project that can check the rewrite.

Once a project pins a release, the working core is free to move, and that is when the harness
can be made generic — the extraction's compromises are recorded in `core/GAPS.md`, closed and
open. What replaces the byte-exact proof is `fixtures/`: one project per shape worth testing,
and ten properties that must hold for each, plus one audit of the layers themselves.

```bash
node scripts/compose-test.mjs        # or: pnpm compose:test
```

1. No `{{PLACEHOLDER}}` survives — the profile's vocabulary covers what the core says.
2. Every unfilled slot belongs to the **project** layer. A declared surface that leaves one of
   its own slots empty is a bug: the core expects text there and nothing supplies it.
3. Nothing from an undeclared surface leaks in, per the fixture's deny list. This is what keeps
   the core from drifting back towards the project it was extracted from.
4. Files gated on a surface appear, or do not, as the fixture expects.
5. Every `Hard Rule #N` reference resolves against the composed `CLAUDE.md`. Most of the numbered
   rules are conditional, so a reference can survive into a project whose rule was dropped.
6. Every composed file carries the `nina:generated` notice, and carries it *below* a frontmatter
   block rather than above one. A subagent spec whose `---` is not at byte 0 stops being
   dispatchable and says nothing about it — the notice exists to prevent silent damage, so it
   must not be able to cause some.
7. Every composed agent spec declares `name:` and `tools:`. A spec with no `tools:` is not
   restricted — the subagent inherits every tool the session has. The reviewer's whole line once
   lived in the frontend surface, so every profile without a frontend composed a "read-only" reviewer
   that could edit anything; the check that its frontmatter opened the file passed the whole time.
8. The composed `.claude/graph.md` holds for the profile: every stage has a spec and every spec is a
   stage, no edge points at a stage the profile lacks, every verdict a stage can emit goes somewhere,
   every loop-back has a cap, and no spec's prose names a route the graph does not have.
9. Every numbered list composes as 1, 2, 3. Surfaces add items to lists the core starts, so a number
   written in one layer cannot know its neighbours in every profile: a project with no surface read
   router rules that began at 2, and an architect whose outputs ran 1–5, 7, 8, 9, 11b, 15. Those lists
   are bullets now, or count within one fragment. The hard rules are the exception, and the composed
   list says so: other documents cite them as `Hard Rule #N`, so the number is an id, and a rule the
   profile lacks leaves a gap.
10. Every composed file fits its size budget (`BUDGETS` in the suite), and no `nina:why` passage
   survives. Every dispatch pays for what its spec says, so a file that outgrows its budget is a decision
   made in the commit that raises it, where a reviewer sees the context grow — not an accretion nobody
   chose.

The last check reads the layers rather than a fixture's output. For every core file, a surface's
technology may be named only if that file is gated on that surface — `Prisma` only under `db`,
`wrangler` only under `edge-cf` — and so may a surface's **role**: `dba` only under `db`,
`integration-tester` only under `integrations`. A role named in ungated prose is an edge to a stage
the next project may not have; the audit found 37 of them the first time it looked, including one
telling a project with neither that "dba and integration-tester run in parallel after the
implementer". And so may a surface's **domain**: `money` only under `money`. It is not a technology,
but it is the same leak — a project with no money read that under-gating a money movement was a
protocol violation and that a production deploy moves real money, 19 times, while every fixture
passed; the heavy-gate list that said "money, the database, auth, an integration" in ten places is now
one list of **critical paths** in the core `CLAUDE.md`, and each surface adds its own entry by slot. The
same pass found six Cloudflare names (`Pages`, `Worker`, a capitalised `Wrangler`) the technology list
had never held. A fixture can only prove what its own profile composes, and a deny
list matches substrings, which makes a word like `Hono` unusable because it fires on `Honor`. Asking
the layers asks once, of everything.

## How to change a rule

Edit the layer that owns it, then recompose. Never edit the output.

Every composed file says so itself: `compose` writes a `<!-- nina:generated -->` notice at the top —
below the frontmatter, where there is any, because Claude Code stops dispatching a subagent spec
whose `---` is not the first thing in the file. The notice names the project layer to edit instead,
or states that the text comes from the harness and cannot be changed from that project at all. The
composition detector already reported a hand edit as drift, but it reported it after the turn was
spent; the notice is the same fact placed where an agent must read it, since `Edit` refuses a file
it has not read.

It names the **slots**, with the labels the core gave them, because "under the slot it belongs to" left
the reader to go and find out which, and the labels are the only thing that says. What it deliberately
does not carry is the pinned version: the notice's bytes would then change in every composed file on
every upgrade, so a project's diff after a move would be twenty files of stamp and one of substance —
the hazard `docs/installing.md` names for the rarer case of the notice's own wording changing. It
names `.nina/profile.json` instead, which costs one read and cannot go stale.

The notice is also the only text an agent cannot skip, and it is worth being exact about how far that
goes. `Edit` and `Write` both refuse a file they have not read, so it reaches every edit of a file that
already exists. It does **not** reach a brand-new file, which needs no prior read, nor a shell edit
through `sed` or a heredoc, nor an agent that only reports. For a change proposed in a report rather
than written, the routing lives in the composed `.claude/retrieval.md`, whose meta-tasks table is
consulted by task type — and that is guidance, not enforcement.

**The edit guard enforces it where it can.** Reaching an agent is not stopping it: one that read the
notice and edited anyway was found only after the turn, as drift, and the next compose wrote over its
work. `core/tree/scripts/edit-guard.mjs` runs on `PreToolUse` for `Edit|Write|MultiEdit|NotebookEdit`
and refuses an edit to a file that carries the `nina:generated` notice — in either comment syntax, below
a frontmatter or a shebang — at a path the pinned version composes, with the notice itself as the reason,
so the refusal names the layer and the slot the change belongs in. The path is half the test: the
integration template composes with a notice and is meant to be copied into `.claude/integrations/`, and
refused on the notice alone every copy was "composed", and the project's own doc could only be edited
through the shell. The compose suite holds every composed notice within the lines the guard reads, and
`check` names an installed package too old to export the guard, which otherwise failed every edit's hook
with a message blaming a missing install. It denies rather than asks: the loop gate asks because it cannot be sure two
rounds are one issue, and here nothing is uncertain. The project's own layer under `.nina/`, files with
no notice, and anything outside the project are let through; it fails open, and acts only where the
pinned version ships it, like the gate. Its hook is in `src/wiring.mjs`, so `init` writes it, `wire`
merges it and `upgrade` waits for it. What it still does not reach is a brand-new file at a composed path
and a shell edit (`sed -i`, a heredoc) — the first carries no notice to read, the second never passes
through an edit tool — and an agent that only reports, for whom `retrieval.md` stays guidance.

```bash
nina compose --project ../Spliter          # rebuild that project's harness files
nina compose --project ../Spliter --check  # exit 1 if the output drifted, or a slot is unfilled
```
