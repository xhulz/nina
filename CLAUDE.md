# NINA — the harness compiler

This repo builds and holds the agent harness that other projects run. It is a Node CLI plus
three layers of text. It is **not** a product, it has no server, no database and no users.

## What the problem was

The harness used to travel by copy-paste. Every new project got a duplicate of `CLAUDE.md`,
`.claude/agents/*` and the rest, and from that moment each copy drifted on its own. A rule
fixed in one project stayed broken in the others, and nobody could tell which copy was
current. This repo exists to make the harness a thing you compose rather than a thing you
copy.

## The three layers

A project's harness files are composed from:

| Layer | Lives in | Holds |
|---|---|---|
| **core** | `core/tree/**` | what is true for every project |
| **surface** | `surfaces/<surface>/tree/**` | what is true for projects that have that surface |
| **project** | `<project>/.nina/project/tree/**` | what is true for one project only |

Each layer mirrors the project tree, so `core/tree/CLAUDE.md` composes to
`<project>/CLAUDE.md` and `core/tree/.claude/agents/reviewer.md` to
`<project>/.claude/agents/reviewer.md`.

Surfaces today: `db`, `money`, `integrations`, `frontend`, `pii`, `edge-cf`, `blockchain`. A project
declares the ones it has in `.nina/profile.json`, along with a `vocabulary` — its own
names for the things the core talks about generically.

Three mechanisms connect the layers:

- **`<!-- nina:slot <surface>.<n> -->`** in a core file marks a hole. The surface (or
  project) file at the same relative path fills it. A slot whose surface the project does
  not declare is dropped, so a project with no database never reads a word about Prisma.
- **`<!-- nina:requires <surface> -->`** on a core file's first line makes the whole file
  conditional. `dba` exists because there is a database, `integration-tester` because there
  is an external service, `solidity-dev` and `solidity-auditor` because code ships immutable — a frontend-only profile composes seven agent specs, not nine.
- **A slot can also end a line** — `tools: Read, Grep, Glob, Bash<!-- nina:slot frontend.1 -->` — for what
  a surface *adds* to a line rather than a line it supplies whole. The one that needed it is a `tools:`
  allowlist: when the whole line lived in the frontend surface, every profile without a frontend
  composed a reviewer with no allowlist at all, and moved into core it granted browser tools to
  projects with no browser. Inline, the core owns the base list and the surface appends to it.
- **`{{VOCABULARY}}`** placeholders are filled from the profile, which is how the core
  states a rule without naming one project's provider, packages or models.

## The rule that keeps this honest

**The composed output must be byte-identical to what is running.** The harness was extracted
by slicing a live project, never by rewriting it, and every line was assigned to exactly one
layer. That is the whole proof that nothing was lost or quietly reworded — and it is the
reason a line cannot simply be edited to read better. Rewriting for clarity belongs to a
later phase, against a second project that can check the rewrite.

Once a project pins a release, the working core is free to move, and that is when the harness
can be made generic — the extraction's compromises are recorded in `core/GAPS.md`, closed and
open. What replaces the byte-exact proof is `fixtures/`: one project per shape worth testing,
and nine properties that must hold for each, plus one audit of the layers themselves.

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

## Installing

NINA is a package with no dependencies. It ships `bin/`, `src/` and every frozen release, so a
project that installs it can compose any version it pins — which is what lets `upgrade` report the
cost of a move before the move happens.

```bash
npm pack                                        # here: xhulz-nina-<version>.tgz, ~157 kB
cp xhulz-nina-0.8.0.tgz ../thing/vendor/        # then, in the consuming project:
pnpm add -D file:vendor/xhulz-nina-0.8.0.tgz
pnpm nina compose                               # the command is `nina` whatever the package is called
```

**A project vendors the packed artifact; it does not link this checkout.** `link:../IA/harness`
puts a symlink in `node_modules`, so the project runs this working tree — uncommitted edits
included. The release pin freezes the layers and nothing freezes the compiler, which does decide
composed output. Vendoring is what makes a project's harness fully determined by three things
recorded in its own repository: the package version, the release pin, and its project layer. A
fresh clone then installs with no registry, no auth, and no harness checkout on the machine.

The package is scoped because `nina` is taken on the public registry. The scope changes what you
install and nothing else: `bin` names the binary, so the command, the banner and every path in this
document stay as they are.

Two consequences worth knowing. **Bumping the package cannot change the rules a project composes**,
because the pin lives in `.nina/profile.json`, not in the dependency range — so `pnpm up nina` only
adds releases the project may later choose, and `nina upgrade` stays the one path that changes a pin.
What a bump *can* change is how a composed file is rendered, because the `nina:generated` notice is
written by the compiler rather than stored in the release: a version that changes its wording makes
every composed file differ until the project recomposes. The detector reports that, correctly.
And **`"core": "dev"`, which tracks the working tree, exists only in a checkout of this repo**; an
installed package says so rather than composing an empty tree.

Measured history does not live in the install. It is the user's, it spans every project, and under
`node_modules` the next install would take it with it — so it lives in `~/.nina/snapshots/`, with
`NINA_DATA` to point it elsewhere.

The package also exports `@xhulz/nina/detectors`, which is the runner behind every project's
`pnpm harness:check`, and `@xhulz/nina/gate`, the loop gate the composed `scripts/loop-gate.mjs` runs. That mechanism used to be a script copied into each project, and the copies
had already drifted — one had learned to run a detector that is a binary on PATH and the other
never did, in the file whose job is to detect drift. It cannot live in a layer either, because this
repo cannot compose itself: composing would overwrite its own `CLAUDE.md`, which is about the
compiler and not about a project's harness. So the mechanism ships in the package and the LIST stays
with the project — `core/tree/scripts/harness-check.mjs` is a dozen lines around a project slot.

**Who reads a finding.** The runner has two hook modes, and the difference is who it reaches. `--hook`
emits a `systemMessage` for a Stop hook, and Claude Code shows that to the person and never to the model.
For a long time that was the only mode, so every detector — drift, a stale map, a lesson owed — reported
to the one reader who was not about to act on it, and closing any loop meant the person relaying it.
`--context` emits `additionalContext` for a UserPromptSubmit hook, which Claude Code puts in the model's
own context before it answers. A project wants both: the Stop hook tells the person what the turn left
behind, the prompt hook tells the model before the next one. Hooks are the project's own
`.claude/settings.json` — NINA composes no settings — so `nina init` writes them where there is no
settings file yet and never edits one that exists, `nina check` asks for whatever is missing, and
`nina wire --apply` merges exactly what is missing into settings that already exist (see *Starting a
project*) — and updates a hook still running the exact command an older `init` or `wire` wrote, so it
too learns to say when its script cannot start; a command someone customised is never touched. Hooks
kept in `.claude/settings.local.json` count: Claude Code reads both files. And "installed" means what
the scripts' own `import` resolves, so a package hoisted to a workspace root counts. The list of hooks is `src/wiring.mjs`, one entry per hook, each naming the composed script
it runs — so a project is only ever asked to wire what its pinned version composes.

For working on the harness itself, `pnpm link` still symlinks `bin/nina.mjs` onto the PATH.

## Starting a project

```bash
mkdir vendor && cp ../IA/harness/xhulz-nina-<version>.tgz vendor/
pnpm add -D file:vendor/xhulz-nina-<version>.tgz        # first: every composed script imports it
npx nina init                                           # interview, profile, TODO, hooks — and compose
npx nina init --surfaces db,money                       # or declare the surfaces instead of the interview
```

The package comes first because every composed script imports it. Without it each hook used to fail
without a word — no drift reported, no lesson owed, no loop cap held — so `init` and `check` now say it
before anything else, and the hooks whose silence would hide it say it themselves: a script that exists
and cannot even start answers the hook with that sentence, to the person on `Stop` and to the model on
`UserPromptSubmit`.

`init` writes `.nina/profile.json` and `.nina/TODO.md`, and **deliberately writes no stub
fragments.**

It **composes**, holes and all, so the hooks it wires have something to run from the first session. The
core's detector list carries a `declaration` detector — `nina check --detector` — so before the model's
first answer in a new project it is told what is still missing and where to fill it from:
`.nina/TODO.md` for the items, `.nina/BRIEF.md` (when the interview wrote one) for what the project is.
The first conversation starts by filling the project in, with nobody having to ask. The composition
detector runs `compose --check --drift` beside it, which reports hand edits and nothing else: both used
to report the unfilled slots, and a new project's first prompt got the same fact twice, the second time
as 57 lines under a hint about hand edits.

It never composes over a file of the project's own. A `CLAUDE.md` or an agent spec written by hand
before the harness arrived — the adoption case — or a symlink where a composed file goes, would be
destroyed; `init` names them, composes nothing, and the TODO says to move them aside (or into the
project layer as fragments) and run `nina compose`.

`--detector` is `check` as a detector, and it differs in two ways. Inside `nina upgrade --apply` it
stays quiet, because the move measures `check` itself, before and after: a new core that adds this
detector, measured against an old harness-check that never ran it, read every problem the project
already had as one the move made, and rolled the move back — `--force` or not. And it leaves out which
skills are installed, a fact about one machine rather than the project, which a `nina check` by hand
still reports. In every mode, only the specs the harness composed are stages: a project may keep agents
of its own beside them.

It also writes the **wiring**, because without it the scripts it composes are never run:
`.claude/settings.json` with every hook the pinned version's scripts need — the harness check's and
the loop gate's — when the project has no settings file, and the `harness:check` and
`harness:compose:check` scripts added to an existing `package.json`. Both files belong to the project
and carry far more than the harness, so `init` never edits settings that exist and a manifest only
gains what it lacks. Whatever `init` could not write is §4 of the TODO, `nina wire --apply` merges it,
and `nina check` reports it as a problem until it is done. The list lives in
`src/wiring.mjs`, read by both — Spliter's wiring was typed by hand one piece per release, and the
piece that let the model see a finding at all came last. A stub is a filled slot as far as every tool is concerned, so a tree of TODOs would
compose and check clean while saying nothing — the exact failure this harness exists to remove.
The project layer stays empty, and `compose` keeps naming what is missing until the work is done.

Two things it can work out rather than ask:

- **The surfaces a repository reveals.** A Prisma schema means `db`, a wrangler config means
  `edge-cf`, a Vite config means `frontend`. `money`, `pii` and `integrations` are claims about the
  domain that no file can settle — `init` says so and leaves them to you.
- **The vocabulary.** Whatever `{{PLACEHOLDER}}` the chosen core and surfaces actually reference is
  what this project must define, and nothing else. A `null` value means "declared, not filled": the
  placeholder stays standing in the composed output instead of quietly becoming an empty string.
  A name the release answers itself is not asked for: `core/vocabulary.json` holds defaults, frozen
  with each release, for what is the same in every project on this stack — the typecheck, lint and
  build commands a stage is told to run, and the test command every stage but qa is told NOT to run.
  qa's own targeted vitest run stays literal: it is the stack's substance, not a command name. The
  core names them as placeholders, a project that declares none composes
  `pnpm typecheck` exactly as before, and one on another stack declares four lines instead of editing
  a core it cannot reach. Declaring a name takes it over, `null` included; `init`'s TODO lists each
  default so there is something to change it from. A release with no such file supplies nothing.

`init` reads the layers from the version it is about to pin, so the checklist describes the harness
the project will actually compose rather than whatever the working tree says today.

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
the hazard this document already names for the rarer case of the notice's own wording changing. It
names `.nina/profile.json` instead, which costs one read and cannot go stale.

The notice is also the only text an agent cannot skip, and it is worth being exact about how far that
goes. `Edit` and `Write` both refuse a file they have not read, so it reaches every edit of a file that
already exists. It does **not** reach a brand-new file, which needs no prior read, nor a shell edit
through `sed` or a heredoc, nor an agent that only reports. For a change proposed in a report rather
than written, the routing lives in the composed `.claude/retrieval.md`, whose meta-tasks table is
consulted by task type — and that is guidance, not enforcement. The mechanism that would enforce it is
a `PreToolUse` hook on the edit tools. NINA composes no `.claude/settings.json` — `init` and `wire` write
hooks into it from `src/wiring.mjs`, and the loop gate is one — but no hook checks where an edit goes.
That is a real limit, recorded here rather than papered over.

```bash
nina compose --project ../Spliter          # rebuild that project's harness files
nina compose --project ../Spliter --check  # exit 1 if the output drifted, or a slot is unfilled
```

## Checking a project, and moving it forward

```bash
nina check --project ../thing               # is what this project declared about itself true?
nina upgrade --project ../thing --to 0.3.0  # what would moving cost? (reports; writes nothing)
nina upgrade --project ../thing --to 0.3.0 --apply
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

**The pipeline is a graph, declared once.** `core/tree/.claude/graph.md` states the stages and every
edge between them — `from → to on TOKEN — when · max N` — and the surfaces that add a stage add its
node and edges through slots, so a project's composed graph contains exactly the stages it has.
It used to exist only as prose, restated across thirteen documents, and prose cannot be checked; now
`nina check` and the compose suite both run `src/graph.mjs` against it, and every other document
describes the graph rather than being a second copy of it. A spec's own "back to **architect**" is
checked against the edges, so the prose can still say it but cannot contradict it.

Every loop-back edge carries a **cap**: how many times the same issue may travel it before the
orchestrator stops and hands the owner every round's report. Before the cap there was no rule anywhere
that could end a loop.

**The loop gate holds the caps.** For a while the cap was an instruction the orchestrator kept by
counting its own rounds. `core/tree/scripts/loop-gate.mjs` is a composed script the project's hooks run,
and it keeps the count instead: a ledger per session under `~/.nina/gate/`, metadata only — which stage
reported which verdict token and the ids it gave its issues, which dispatch launched which agent and
when, when the owner spoke — written by the hooks that see each fact as it happens. An issue id is the
one thing in it a model wrote: a label of at most 40 characters from the `ISSUES` line every spec puts
under a verdict that sends work back, never a sentence of the report. A stage's report comes from `PostToolUse` on
`SubagentHandback`, verbatim, or from `SubagentStop` when the report was the last message; launches from
`PreToolUse` and `PostToolUse` on `Agent|Task|SendMessage`; the owner from `UserPromptSubmit` and an
`AskUserQuestion` answer. `PreToolUse` decides.

**At the cap it asks the owner.** The graph sends a loop that has used its rounds to `human`, so that is
where the round past the cap goes: the hook answers `permissionDecision: "ask"`, and Claude Code puts the
dispatch in front of the person — in auto mode too, which was probed rather than assumed. Allowed, it is
one more round and the next one asks again; refused, the model is told no, and `router.md` tells it to
stop and hand over each round's report. It was a denial first. Three reviews of the counting each found
a shape it got wrong, because whether two rounds are "the same issue" cannot be seen from outside the
conversation — and a confirmation makes a wrong count cost one click instead of a stopped pipeline.

It does not read the session transcript to decide, for two reasons found before a line of it was
written: Claude Code writes that file asynchronously, so at a `PreToolUse` the verdict being acted on may
not be on disk yet; and a session resumed over a bridge rewrites its own history — 74% of one 385 MB
transcript was replay. (It reads a subagent's own transcript in one case: to find the handback of a
stage whose last message was a comment written after it.)

What counts as a round was replayed over six weeks of one project's history first, and reviewed three
times after. The obvious count — a dispatch to the stage an edge points at, after a loop-back from its
source — reached a cap eight times, and seven were different issues on the same edge. So:

- a round is a dispatch that **acts on** a declared loop-back, and several dispatches acting on the same
  verdicts are one round;
- a rejection from a review that was already running when the edge's last round went out belongs to
  that round, not to a new one;
- a pass cancels a rejection only if a fix went out between the two — a later review that saw the fix —
  and closes the loop only if it began after the latest fix with no rejection running beside it, so a
  fan-out's sibling approving, or a reviewer of another dimension launched later, releases nothing;
- a pass from the stage the source hands passing work on to — qa, after the reviewer — closes the
  source's loops, which is how a rejection the orchestrator settled itself stops counting; but only if
  that stage ran after the source last reported and the source was not sent out again since, because
  the graph sends the reviewer out beside every gate, and its approval says nothing about the dba's
  rejection;
- the owner speaking starts every count over; a verdict guessed from prose never counts;
- where every report a round acts on named its issues — the `ISSUES` line every spec puts under a verdict
  that sends work back — the round is counted per issue, not per edge. The graph always said a different
  issue on the same edge starts its own count, and the gate could not see issues, so it counted the edge:
  a review that found a new problem each round asked the owner exactly like a fix that was not
  converging. The re-check keeps the id of an issue still open, because the orchestrator carries the line
  into its dispatch. An id is a model's word, and a renamed issue restarts its count, so the edge keeps
  counting beside it and still asks once it has gone round more than twice its cap with no approval
  between. A round acting on any report that named nothing is counted by its edge, as before — and so is
  the rest of that loop until it closes, because that round advanced no issue's count, and going back to
  counting by issue would buy the loop a silent round. A late sibling's issues are counted in the round it
  belongs to, like its rejection.

The one real repeat in that history still reaches its cap. Reading "the stage that owns the fix" off a
report's second line was tried and removed: in real reports it named the wrong stage, and a named owner
that was never dispatched let a loop run uncounted.

Two rules exist because the live hooks were probed. `UserPromptSubmit` fires when a subagent's report is
delivered (`<agent-message …>`, with or without a sentence in front of it) and when a background task
finishes, not only when a person types — resetting on those would have emptied every count each time a
report arrived, so only a prompt with no such tag near its start resets. And a stage calls
`SubagentHandback` itself and then writes a short comment, so the stop sees the comment: the verdict is
taken from the handback. A first version also sent back any report whose first line was not its
`VERDICT` — it would have sent back nearly every real one, and since the handbacks already declare their
verdicts, it was dropped rather than fixed. A scheduled prompt (`/loop`) carries no such tag, so it
resets the count like a person would; that is a known limit.

It fails open, and only acts where the pinned version ships it: a composed file outlives the version that
composed it, and wired hooks run whatever is on disk, so the script asks the pin. An error lets the call
through and is logged, and `nina gate --selftest` — a detector in every project's `harness:check` —
reports what nothing else would notice: missing hooks or matchers that do not reach their tools (read the
way Claude Code reads them), a ledger it cannot write, failures since anyone was told (each reported
once, to whichever hook runs first), and a dry run of a whole loop through the project's own hook
command, which must send exactly the round past the cap to the owner. What it cannot see is stated
rather than hidden: a fix the orchestrator makes itself without a subagent, and "the same issue" beyond
what the verdicts show — so `router.md` still asks the model to keep its own count.

`nina wire` merges the hooks and npm scripts a version needs into a project's existing settings. With
`--to <version>` it wires a version not pinned yet, which is safe: every hook runs its script only once
that script is composed. `upgrade` refuses a move that composes a hooked script for the first time until
its hooks are in place, and prints them.

`pills` answers a third question, about the only part of the harness the pipeline writes for
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

`upgrade` exists for one risk. What breaks in an upgrade is not the harness; it is the text the
**project** already wrote that the new core has nowhere to put. A fragment whose slot was renamed or
dropped composes to nothing, and no check notices, because nothing is missing — it is just gone. So
`upgrade` reports first and refuses to apply while anything would lose meaning. Reconciling fragments
is work, and work does not get done by a flag.

What `--apply` does do is run the rest of the move, because the rest was six commands in a fixed
order and a procedure nobody can hold in their head is not a procedure — getting the order wrong
overwrote a project's own file:

```
  pinned 0.13.0
  ✓  composing the harness files — 17 file(s)
  ✓  checking the declaration — check: declaration is sound
  ✓  validating the pills — pills: all 13 well formed
  ✓  running the project's own detectors — harness: current (4 detectors clean)

  upgrade: 0.7.0 → 0.13.0 applied and verified.
```

A step that fails **puts the project back**: the old version is pinned again, the tree is recomposed
against it, and the failing step's own output is printed. The pin and the composed files move
together or not at all, because a project pinned to one version and composed from another is the
one state nothing downstream reports.

Every step that is re-run after the move is also measured **before** it, and one the project was
already failing is reported rather than rolled back for — otherwise the upgrade takes the blame for a
problem it found rather than caused. Measured is the operative word: this held for the validations and
not for the project's own detectors, so `check` was excused for an open slot while the detector step,
reading that same fact through a different command, put the whole move back. They are one list now, so
a step added later is measured without anyone remembering to measure it.

Measured means the findings, not the exit code. A step that was failing before used to be excused
whole, so a project already missing one hook had everything else the move broke in that step waved
through with it. It is excused now only for what it already said: a failure the move added is the
move's doing, and rolls it back — or, under `--force`, is listed once the move is done. Notes are not
failures, so a slot the move creates, reported as a note, can never roll it back.

Compose writes and never deletes, so the move does the deleting. Right after it composes — before
anything is verified, so what is verified is what stays — it removes the files the old version composed
and the new one does not, unless they carry edits of the project's own, which are kept and named. If it
rolls back, it removes the files it composed for the first time, recomposes the old version, and then
writes back every file the move could touch exactly as it was — the recompose alone used to write the
old composition over the owner's own edits and call the tree restored. A file of the project's own at a
path the new version starts composing is refused in the preview; under `--force` it is replaced, with a
copy kept in `.nina/replaced/` first. Without that, a rolled-back move left the new version's
loop gate on disk, run by hooks the owner had just wired for it, on a pin that has no gate. Hooks a move
needs cannot be forced past either: `upgrade` prints them and refuses until
`nina wire --to <version> --apply` has put them in.

There is one failure it must **not** roll back for: a project slot the move itself creates. A new core
can introduce one, and it cannot be filled before the core that introduces it is pinned — so failing
on it leaves no order in which the upgrade ever completes. The preview already works out which slots
are new, so those are named to every validation that fails on one: `check` by flag, and the project's
own `compose --check` through the environment, because that one is reached through an npm script whose
arguments this command does not own. Both read the list from `src/expected.mjs` rather than parsing
their own, since the first fix taught one of the two and the deadlock simply moved one step down the
chain. The exemption is exactly as wide as the slots named and lasts exactly as long as the move: the
next `harness:check` reports them again, and the success line names them, because a move that composed
a hole and said "verified" is the silence this harness exists to remove.

## Releases — why work here does not move a project that is shipping

A project pins a frozen version of the harness in its profile (`"core": "0.1.0"`), and
composes from `releases/<version>/` rather than from the working `core/` and `surfaces/`.
Without that, the first edit here makes every consuming project's composition detector
report drift on every turn — the same noise the detectors exist to remove.

```bash
nina release 0.2.0      # freeze the working core + surfaces; releases are never rewritten
```

The cut also writes the package's own `version`. The package **ships** `releases/`, so a package
number below the newest release describes nothing that is inside it — 0.5.1 shipped releases
through 0.7.0 because two cuts went by without a bump, and the banner announced the stale number
for both. Cutting is the one moment the compiler and the layers are known to agree, so that is
where the number is written rather than remembered. The field is replaced on its line, not by
re-serializing the parsed object: a round trip rewrites every line of the file, and on a
`package.json` with no `version` at all it would invent one.

The consequence worth accepting: a compiler-only change still cuts a release, whose layers are
byte-identical to the one before it. That costs ~400 KB and keeps one number meaning one thing.
A project does not follow it — pins move only through `nina upgrade`.

Cutting a release **changes what `init` does**, because `init` pins the newest one when none is
named — a new surface starts being offered the moment it is frozen. So the suite runs *after* the
cut, not only before it: a release is the one repo operation whose effect is not in the diff. The
newest is chosen by number rather than as text, or `0.10.0` would sort below `0.9.0` and a command
that defaults to the newest would quietly pin the one before it.

A profile that pins a release which is not in `releases/` is an **error**, not a fall back to
the working tree: composing an unreviewed core into a project that asked for a reviewed one
is the kind of thing nothing downstream would report. A project tracks the working tree
deliberately, with `"core": "dev"`.

Consuming projects run `--check` as a detector inside their own `harness:check`, so a hand
edit to a generated file reports as drift. If a change makes a core file expect text that no
declared layer provides, `compose` names the unfilled slots instead of writing a hole.

## The other half: measurement

The CLI also reads Claude Code's own transcripts under `~/.claude/projects/` to measure what
the pipeline actually did — which stage ran, what verdict it declared, how often it sent work
back.

```bash
nina snapshot    # append new dispatches to ~/.nina/snapshots/<project>.jsonl
nina stats       # loop-back rate per stage, and what the pipeline learned from it
```

`stats` closes with a **learning** block, because a loop-back is the raw material and a pill is the
product, and the rule that turns one into the other is the only rule in the harness that nothing
else can check. It resolves each measured project back to its directory — the snapshot encodes the
path with every separator flattened to a dash, so the split is resolved against the filesystem
rather than guessed — reads its `.claude/pills/`, and puts the two counts on the same screen:

```
  learning
    78 loop-back(s) in the window → 2 pill(s) written (3%) — the router writes one on every loop-back.
    0 of 13 pill(s) retired — no correction has ever graduated into a rule.
    557 dispatch(es) since the newest pill (2026-09-03).
```

Those were the real numbers when the block was built. A pill with no date is counted and said to be
unplaceable rather than dropped, and a project whose directory cannot be found is named rather than
read as a zero — in a report about something not happening, a silent miss and a true zero look
identical.

`~/.nina/snapshots/` holds **metadata only** — role, verdict, timestamps, duration, branch,
which skills were invoked, how many pills the run opened, how many issues a loop-back named. No report
text, no source, no PII, not even a pill's path or an issue's id. Keep it that way.

### The learning cycle

`stats` measures across projects; `nina learn` asks one project whether its pipeline is learning
from its own runs, and it answers link by link, because the cycle is only as real as its weakest one:

```
  observe   826 dispatch(es) recorded, 2026-08-12 → 2026-09-22
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

The measurement store is the only copy of history older than Claude Code's transcript retention, so a
snapshot must never make a record worse. A dispatch already on record is never re-created, and a
notification already read is not read twice — re-walking bytes after a cursor went back used to blank a
record and count a resume that never happened, and once the snapshot wrote whenever a record changed,
it wrote the blank over the good one. Cursors live beside each project's records, written by rename:
one shared file, rewritten whole by every project's hook, let the later of two concurrent writers put
every other project's cursor back.

The lesson counts were added to the record after 826 dispatches were already captured. Those were filled
in from their transcripts on the next snapshot, without `--rebuild` — a rebuild re-reads only what is
still on disk, and Claude Code prunes old transcripts, so it would have dropped every record older
than the retention window. A record whose transcript is gone keeps what it had.

This half exists because every rule the harness could not enforce was invisible until
measured: mandatory skills were invoked 2 times in 743 runs before anyone counted.

## Layout

```
bin/nina.mjs          entry point and command table
src/commands/         init, compose, check, where, pills, learn, wire, gate, upgrade, release, snapshot, stats
src/graph.mjs         parses and validates a composed pipeline graph (check + compose suite)
src/gate.mjs          the loop gate: the ledger, what counts as a round, one answer per hook event
src/wiring.mjs        the hooks and npm scripts a project needs — read by init, wire, check and upgrade
src/vocabulary.mjs    the vocabulary a release answers itself, from core/vocabulary.json
src/transcripts.mjs   the transcript parser (dispatch/verdict/skill extraction)
src/detectors.mjs     runs a project's drift detectors (imported by its harness-check)
src/banner.mjs        the startup banner
core/ surfaces/       the harness itself, as it is being worked on
releases/<version>/   frozen copies that projects pin to
fixtures/             projects that exist to be composed and checked
scripts/              this repo's own drift detectors
~/.nina/snapshots/    measured pipeline history (NOT in the repo — see Installing)
```

## Working in this repo

Work directly. There is no subagent pipeline here — this repo *produces* one, it does not run
one. Dispatching planner → architect → implementer for a CLI change is exactly the over-gating
the harness calls a failure.

The repository is public at github.com/xhulz/nina, and its `main` takes changes only through a pull
request: work on a branch, push it, open the PR, rebase-merge it. Never force-push. The history from
before the source was published is not part of this repository and must never be pushed to it.
