# Pills, and the learning cycle

The corrections the pipeline writes about itself, and how a lesson learned three times becomes a rule. Read before touching `src/commands/pills.mjs` or `src/commands/learn.mjs`.

`pills` answers a question of its own, about the only part of the harness the pipeline writes for
itself. A correction is written on a loop-back and then nothing ever reads it back, so three
failures are invisible: a pill with no frontmatter cannot be filtered by `status` or `trigger`, a
pill in `architect/` that declares `applies_to: [architect, implementer]` is never delivered to the
implementer, and a pill with neither `citations` nor a `source` is the unfounded claim this harness
exists to remove. All three look fine to a human skimming the directory. The format they are checked
against is `core/tree/.claude/pills/README.md`, so it composes into every project.

```bash
nina pills --project ../thing            # is the corpus well formed, delivered, and still true?
nina pills --project ../thing --quiet    # detector mode: silent unless something is wrong
```

It reports a third thing: a pill that has recurred three times, with the layer its lesson should
move to — the core when the roles it applies to are composed by every project, the surface those
roles exist for otherwise. Composition strips the `nina:requires` gate, so that answer comes from
the layers rather than from the composed spec. It is a note, not a failure, because a recurring
lesson is work to do rather than a defect.

It also resolves every `citations` entry against the repository, which is the one part of a pill
that can be checked against the world at all. A path that is gone, or a line past the end of the
file it names, fails: the pill is sending an agent to look at something that is not there. A
citation that still resolves inside a file which changed **after** the pill's `date` is a note, not
a failure — the line survived but the code on it may have moved on, and nothing can settle that
mechanically. Only committed history counts, so an uncommitted edit does not register; a pill is
checked against what the repository says, not against one working tree.

## The learning cycle

`stats` measures across projects; `nina learn` asks one project whether its pipeline is learning
from its own runs, and it answers link by link, because the cycle is only as real as its weakest one:

```
  observe   826 run(s) in 843 round(s) recorded, 2026-08-12 → 2026-09-22
  capture   ✗ reviewer: 24 loop-back(s) since its newest lesson (2026-09-03)
  apply     592 of 646 run(s) of roles that have lessons opened their pills (92%)
  graduate  0 lesson(s) at 3+ occurrences · 0 request(s) open
  verify    reviewer/…-never-write-to-repo-files.md (2026-09-03): 2% → 29% loop-back (n 43 → 104)
```

Those were the first real numbers. An audit had found four of the five links open. **Capture** ran
at 3% of the rate the router demanded, because the rule was "a pill on every loop-back" and a rule
that asks a lesson of a typo trains everyone to skip the real ones; it is now "ask whether it would
happen again", and the outcome is watched instead of the ritual. **Apply** was called unmeasurable —
nothing read the transcripts for it — and once something did, 92% of runs turned out to open their
pills. **Graduate** had never fired and could not: no pill had ever had `occurrences` bumped past 1.
**Verify** did not exist at all, so no lesson could ever be shown to have helped.

- `--check` is a detector every composed project runs, shipped in the core `harness-check.mjs` with
  no npm script to opt into. It fires on an **event** — a role sent back three times in fourteen
  days since its newest lesson — not on a rate: a ratio that moves over weeks, reported every turn,
  is the noise the detectors exist to remove. Relearning counts as capture: bumping `occurrences`
  sets `last_seen`, and that settles it too. It also snapshots its own project first, so a project
  observes itself instead of depending on one global hook pointed at a checkout of this repo.
- **Graduation needs no command in the project.** A lesson learned a third time is sent by `--check`
  itself as a **request** under the project's `.nina/requests/` — the pinned version, the layer the
  rule belongs in, the lesson in the project's words — because a project cannot edit the harness,
  only ask, and asking decides nothing. `nina requests`, run here, is this repository's inbox: every
  open request from every project measured on the machine. It is answered here too, with
  `--answer <request> --in <layer file>` or `--decline <request> --why <reason>`, into
  `core/answered.json`, which the next release freezes. The `nina upgrade --apply` that installs that
  release closes the request in its project and retires the pill; a decline leaves the pill active,
  because the lesson is still true where it was learned. The answer is not written into the project
  from here: this repository does not edit the projects it serves, and an answer only becomes true
  for a project when it installs the release that carries it — and a rule that went into a surface
  the project does not declare closes its request without retiring the pill, since the rule never
  arrives there. Before this, both of the project's ends were commands somebody had to remember — the detector announced the first with a hint telling the project to
  write a lesson it had already written three times, and nothing prompted the second at all. The
  compose suite checks every answer names a layer file that exists, since the upgrade tells the
  project its rule lives there.
- Verify is a before/after of the lesson's roles' loop-back rate. It is not proof — the work changes
  and small samples swing, and the first two readings went UP after their lessons, which may mean
  a reviewer that catches more rather than one that learned less. Without it, though, the question
  could not even be asked.

The first project started from nothing graduated six lessons in its first two days, the first time the
whole cycle ran without anyone prompting a link of it. Four were about the code the implementer hands on:
tests that stayed green under the very mutation they named, branches that reported "ok" on input they
could not read, a hostname pattern written from a wrong model of the format, and READMEs that described
the code as intended. One was the architect's: a correction that left older text in the spec saying the
opposite. One widened Hard Rule #9 to members. All six were answered into the core in 0.28.14, the four
about code in both the implementer and the reviewer, since a rule the writer holds and the reviewer does
not check is a rule followed when convenient. The test lesson had graduated once before, from the other
project, as "name the mutation"; it came back five times because naming it was not the same as walking it
through the fixture, so the rule now says how the naming fails.

## Reading the loop-backs: `learn --deep`

`learn` counts: a role sent back three times since its newest lesson is owed one. It cannot say what the
three were about, whether they were one mistake or three, or whether a pill on disk already covers them —
and capture ran at 8% of loop-backs on 2026-09-24 (3% in the window first measured), so most of what the pipeline could have learned was never written
down. `nina learn --deep` reads the reports themselves, from each run's own transcript — its
`SubagentHandback`, or its last message for a run from before that tool existed — and asks a model in a
few calls: map, one sentence per report on what the upstream stage got wrong and whether it would happen
again; reduce, which causes are the same, which pill already covers each, and a proposed pill for a
recurring cause none does.

```bash
nina learn --project ../thing --deep [--days 30] [--model haiku] [--dry-run] [--api]
```

It proposes and writes nothing: a lesson becomes a pill when the orchestrator or the owner files it. It
runs on the Claude Code login, never a per-token key unless `--api` asks for one — the billing credentials
are stripped as `eval` strips them, from the same function — with no tools, on a small model by default, answering to a JSON
schema. What it says is believed only as far as it can be checked: a ref it did not read is dropped, and
a pill it names that is not on disk covers nothing and is named as invented. The reports go to the model
and nowhere else; the snapshot keeps no report text, and neither does this. Nor does a call leave a project behind: Claude
Code files every `claude -p` under `~/.claude/projects/` by its working directory, session or not, so each
call runs in one shared directory and removes that entry afterwards when it holds nothing but a title.

The first reading, over one project's 70 loop-backs in thirty days, took 6 calls and $0.56 API-equivalent
on the login. Its largest causes were test assertions not updated when rendering changed (7), an
implementer omitting part of the spec (6), and tests that needed live credentials with no mock (5); it
proposed five pills, among them "a test assertion must be able to fail" and a database client's
`updateMany` with empty `data` not touching the update timestamp.

