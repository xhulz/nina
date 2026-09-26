# Installing NINA, and starting a project

How a project gets NINA and a first harness: the published package, `init`, the vocabulary and its defaults, and the wiring. Read before touching `src/commands/init.mjs`, `src/commands/wire.mjs`, `src/wiring.mjs`, `src/vocabulary.mjs`, `core/vocabulary.json`, `src/paths.mjs` or the detectors.

## Installing

NINA is a package with no dependencies. It ships `bin/`, `src/` and every frozen release, so a
project that installs it can compose any version it pins — which is what lets `upgrade` report the
cost of a move before the move happens.

```bash
pnpm add -D -E @xhulz/nina       # an exact version, in package.json and in the lockfile
pnpm nina compose                # the command is `nina` whatever the package is called
```

**A project installs a published version; it does not link this checkout.** `link:../IA/harness`
puts a symlink in `node_modules`, so the project runs this working tree — uncommitted edits
included. The release pin freezes the layers and nothing freezes the compiler, which does decide
composed output. An exact version is what makes a project's harness fully determined by three things
recorded in its own repository: the package version, the release pin, and its project layer. The
lockfile keeps the version's integrity hash, and the registry is public, so a fresh clone installs with
no auth and no harness checkout on the machine.

Until 0.28.15 a project vendored the packed `.tgz` instead, which kept the same three things but needed the
file copied into every project by hand at every release, and a hook that could not start told the person to
install that file. The hooks an older `init` or `wire` wrote still say so, and `nina wire --apply` updates
them. Publishing is not a step anyone takes: a release cut on a branch and merged to `main` is published by
`.github/workflows/publish.yml`, once, after the suites pass on a clean runner. npm trusts that workflow in
this repository through OIDC (trusted publishing), so no token exists to leak, and every version carries
the provenance of the build that made it. `npm pack` still builds the same file locally, to try one before
it ships.

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
`pnpm harness:check`, `@xhulz/nina/gate`, the loop gate the composed `scripts/loop-gate.mjs` runs, and
`@xhulz/nina/guard`, the edit guard `scripts/edit-guard.mjs` runs. That mechanism used to be a script copied into each project, and the copies
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
behind, the prompt hook tells the model before the next one. They are not told alike. The model is
handed every finding before every message, since that is what it acts on, but in full once: one it was
handed at the last message, unchanged, goes as its detector's summary, with the instruction not to say it
again and the command that prints it in full. Handed the whole list each time, with the instruction to act
on it or say it was pending, the model in a new project closed every answer, whatever it was about, with
the same line: the project's name and owner were still unfilled. A finding that changes, or clears and
comes back, goes in full again, and each copy handed over stays in the conversation, so the summary is
also what keeps a long session from carrying the list forty times. The person hears only what
the turn itself left behind: the prompt hook records, per session, which findings it handed the model,
and the Stop hook says nothing about those, because the model already had them and relayed them. A
finding the turn produced (a hand edit to a composed file, a lesson owed after it) is one line, the
detector's own summary (`lessons — 1 role(s) keep being sent back`), said once; one that clears and comes
back is told again. The first new project showed why. The model relayed its eighteen pending items in a
paragraph, and the Stop hook then printed the same eighteen raw, twenty-two lines prefixed `Stop says:`,
under every answer; cut to one line said once per session, it was still the harness talking about what
the person had just been told. Without a record from the prompt hook, every finding counts as new. The
records are kept per project under `~/.nina/hooks/`, a session each.

A finding that happens once is spent only by the prompt hook: the gate failing, a lesson sent to the
harness, an export to Langfuse that failed. Each detector is told which hook runs it (`NINA_HOOK`), and
until the prompt hook hands such a finding to the model, every run reports it, the Stop hook's and one by
hand included; the Stop hook, which sends nothing, says a lesson is about to go. Spent by whichever run saw
it first, each was spent by the Stop hook as a rule: its one line told the person the model would be told
before their next message, and by then there was nothing left to tell it. Hooks are the project's own
`.claude/settings.json` — NINA composes no settings — so `nina init` writes them where there is no
settings file yet and never edits one that exists, `nina check` asks for whatever is missing, and
`nina wire --apply` merges exactly what is missing into settings that already exist (see *Starting a
project*) — and updates a hook still running the exact command an older `init` or `wire` wrote, so it
too learns to say when its script cannot start; a command someone customised is never touched. Hooks
kept in `.claude/settings.local.json` count: Claude Code reads both files. And "installed" means what
the scripts' own `import` resolves, so a package hoisted to a workspace root counts. The list of hooks is `src/wiring.mjs`, one entry per hook, each naming the composed script
it runs — so a project is only ever asked to wire what its pinned version composes.

`nina wire` merges the hooks and npm scripts a version needs into a project's existing settings. With
`--to <version>` it wires a version not pinned yet, which is safe: every hook runs its script only once
that script is composed. `upgrade` refuses a move that composes a hooked script for the first time until
its hooks are in place, and prints them.

For working on the harness itself, `pnpm link` still symlinks `bin/nina.mjs` onto the PATH.

## Starting a project

```bash
pnpm add -D -E @xhulz/nina                              # first: every composed script imports it
npx nina init                                           # interview, profile, TODO, hooks — and compose
npx nina init --surfaces db,money                       # or declare the surfaces instead of the interview
```

The package comes first because every composed script imports it. Without it each hook used to fail
without a word — no drift reported, no lesson owed, no loop cap held — so `init` and `check` now say it
before anything else, and the hooks whose silence would hide it say it themselves: a script that exists
and cannot even start answers the hook with that sentence, to the person on `Stop` and to the model on
`UserPromptSubmit`.

On a terminal, `init` interviews: a few sentences on what the project is, kept in `.nina/BRIEF.md`, then
one yes-or-no question per surface. The questions are numbered, and asked in the order projects need
them, `db` and `frontend` first and `blockchain` last: asked alphabetically, the first thing a web app was
asked was whether it deploys immutable code, and the header never said the questions were the surfaces.
Each says what a yes brings in what a person would recognise, roles, hard rules and agents changed,
rather than the count of fragments the harness measures it by, which it falls back to only for a surface
that brings none of those. A surface a file already confirms says so, and an
empty answer keeps it. Colour follows the banner: on a terminal only, and never under `NO_COLOR`.

`init` writes `.nina/profile.json` and `.nina/TODO.md`, and **deliberately writes no stub
fragments.**

It **composes**, holes and all, so the hooks it wires have something to run from the first session. The
core's detector list carries a `declaration` detector — `nina check --detector` — so before the model's
first answer in a new project it is told what is still missing and where to fill it from:
`.nina/TODO.md` for the items, `.nina/BRIEF.md` (when the interview wrote one) for what the project is.
The first conversation starts by filling the project in, with nobody having to ask. A list says what is
missing and not where to begin, and the first new project's model met eighteen items at one weight and
offered to read the brief "if it exists". So until `.claude/architecture.md` is written, the detector
opens by telling the model the list is not the conversation: read the brief before answering (or, with
no brief, what the project already says about itself, its README and code, asking the owner only when
there is nothing to read), open with what the project is, propose writing the architecture together, ask
the first question it raises, and do not recite the list, which is in the TODO and mostly decided by that
architecture. Given only the order,
the model still led with the inventory; given this, it answered a new project's "hello" by summing up the
brief and asking what the scoring engine it names actually is. A person running `nina check` by hand gets
the order instead. Once the architecture is written the order is done, and the check points at the brief
alone. The order is read off that one document, not off the directory:
a first version judged the project new by its files, never noticed the architecture being written, and
dropped the order when an editor's settings folder appeared. The composition
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
still reports. A skill is what a spec's "Skills you MUST consult" section lists, in bold or as the first
cell of a table row. Every name in backticks there used to count, and in some roles the project's own
introduction composes inside that section, so a project that wrote its region as `us-east-1` was told
that skill was not installed. In every mode, only the specs the harness composed are stages: a project
may keep agents of its own beside them.

It also writes the **wiring**, because without it the scripts it composes are never run:
`.claude/settings.json` with every hook the pinned version's scripts need — the harness check's, the
loop gate's and the edit guard's — when the project has no settings file, and the `harness:check` and
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
  a core it cannot reach. `STEP_FILES`, the most files one implementer run may write (15), is a default
  for the same reason: the limit is the harness's, and a project whose files are unusually small or
  large moves it without editing a rule. `nina stats` reads the same value. The model and effort level each
  stage runs at are five more (`DEEP_MODEL`, `DEEP_EFFORT`, `ARCHITECT_EFFORT`, `WORK_MODEL`, `WORK_EFFORT`): with an alias and
  no level, a stage ran on whatever the alias pointed to that week, at whatever the session was set to
  (see [measurement](measurement.md#at-what-effort)). Declaring a name takes it
  over, `null` included; `init`'s TODO lists each default so there is something to change it from. A
  release with no such file supplies nothing.

`init` reads the layers from the version it is about to pin, so the checklist describes the harness
the project will actually compose rather than whatever the working tree says today.
