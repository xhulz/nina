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
- **`<!-- nina:why -->…<!-- /nina:why -->`** marks a passage that tells how a rule came to be, as the
  history of the project it was learned in: "it was followed 3% of the time", "2 invocations in 743 runs".
  That is for whoever maintains the harness; it stays in the layers and is not composed, so no dispatch in
  a project pays for it. The rule, and a reason that generalizes, stay. Each piece — the core file, each
  fragment — is stripped on its own before they are joined: stripped after, an opener left unclosed in a
  project fragment paired with the closer of a core passage forty lines down and deleted every rule between
  them without a word. A marker still standing after that was left unclosed; it composes as text and
  `compose` names it, `--check` failing. A slot inside a passage would compose to nothing, so the layer
  audit refuses one; and the readers that ask what a project owes — vocabulary, documents, the leak audit —
  read the layers with the passages stripped too. Markers are matched as written, fenced code included.
  The first six passages marked saved 0.4% of the largest composition — the narrative was mostly already
  gone — and the size budget beside it is what keeps it from coming back.
- **`{{VOCABULARY}}`** placeholders are filled from the profile, which is how the core
  states a rule without naming one project's provider, packages or models.

## What must stay true

Each of these has a document behind it (the table below); this is the short form an agent working here
must not break.

- **The composed output is never edited.** A rule changes in the layer that owns it, then the project
  recomposes. Every composed file says so in its `nina:generated` notice, and in a project the edit guard
  refuses an edit to one.
- **Every fixture holds the properties the compose suite lists, and every layer holds its audit** — `pnpm compose:test`. A
  surface's technology, role or domain is named only where the file is gated on that surface; a composed
  document fits its size budget; a numbered list counts 1, 2, 3 except the hard rules, whose numbers are ids.
- **A release is never rewritten.** A compiler-only change still cuts one, and the suites run again after
  the cut: cutting changes what `init` pins, which is the one effect not in the diff.
- **One mechanism per fact.** When two commands report the same fact, one reads the other — `src/expected.mjs`,
  `src/wiring.mjs`, `generatedNotice`. A second copy drifting from the first has shipped here more than once.
- **This repository does not edit the projects it serves.** A project vendors the packed tarball
  rather than linking this checkout, pins a release, and moves only through its own `nina upgrade`; work
  here ends at `nina release` and `npm pack`. An answer to a project's request becomes true for it only
  when it installs the release that carries it.
- **The measurement store is metadata only**: counts, verdicts, timestamps, tokens, never report text,
  source, PII, an id a model wrote, or dollars.
- **Nothing here bills per token by accident.** `nina eval` runs on the Claude Code login and strips every
  billing credential from its child unless `--api` asks for it.
- **The suites are `node scripts/cli-test.mjs`, `node scripts/compose-test.mjs` and
  `node scripts/harness-check.mjs`** — each exit code read directly, never through a pipe, where the status
  is the last command's. A rule change is proven by a mutation: undo the rule, and some test must fail.

## Before you change something, read

| To change | Read first |
|---|---|
| a layer, `compose`, the notice, `nina:why`, the size budgets, the edit guard, the tools a spec may use | [`docs/composition.md`](docs/composition.md) |
| `init`, `wire`, the hooks a project needs, the vocabulary and its defaults, how a project installs NINA | [`docs/installing.md`](docs/installing.md) |
| `check`, `where` | [`docs/checking.md`](docs/checking.md) |
| the pipeline graph, the loop gate, the `ISSUES` line | [`docs/loop-gate.md`](docs/loop-gate.md) |
| `upgrade`, `release`, what a move may or may not roll back for | [`docs/upgrading.md`](docs/upgrading.md) |
| `snapshot`, `stats`, cost, proportion, `eval` | [`docs/measurement.md`](docs/measurement.md) |
| `pills`, `learn`, `requests` | [`docs/learning.md`](docs/learning.md) |

Each document says why its mechanism ended up the way it did — usually because the obvious version was
tried first and failed on real data. Read the reason before undoing it.

## Commands

```bash
nina init --project ../thing                  # profile, TODO, wiring, and a first composition
nina compose --project ../thing [--check]     # rebuild a project's harness files, or say if they drifted
nina check --project ../thing                 # is what the project declared about itself true?
nina where <path> --project ../thing          # does this path belong to the harness, and which layer?
nina wire --project ../thing [--apply]        # merge the hooks and npm scripts its version needs
nina upgrade --project ../thing --to <v> [--apply]   # what a move costs, then the whole move
nina gate --selftest --project ../thing       # would the loop gate still hold a loop past its cap?
nina pills --project ../thing                 # is the pipeline's own corpus of corrections sound?
nina learn --project ../thing                 # is the pipeline learning from its runs, link by link?
nina requests                                 # the lessons projects have graduated to the harness
nina snapshot && nina stats                   # measure what the pipeline did, and what it cost
nina eval --release <a> --release <b>         # which release's reviewer catches more planted defects
nina release <version>                        # freeze the working layers; never rewritten
```

## Layout

```
bin/nina.mjs          entry point and command table
src/commands/         init, compose, check, where, pills, learn, wire, gate, upgrade, release, snapshot, stats, eval
src/graph.mjs         parses and validates a composed pipeline graph (check + compose suite)
src/gate.mjs          the loop gate: the ledger, what counts as a round, one answer per hook event
src/guard.mjs         the edit guard: refuses an edit to a composed file, quoting where it belongs
src/wiring.mjs        the hooks and npm scripts a project needs — read by init, wire, check and upgrade
src/vocabulary.mjs    the vocabulary a release answers itself, from core/vocabulary.json
src/prices.mjs        API list prices by model, dated, for what stats estimates a run cost
src/transcripts.mjs   the transcript parser (dispatch/verdict/skill extraction)
src/detectors.mjs     runs a project's drift detectors (imported by its harness-check)
src/banner.mjs        the startup banner
core/ surfaces/       the harness itself, as it is being worked on
releases/<version>/   frozen copies that projects pin to
fixtures/             projects that exist to be composed and checked
evals/                a change with planted defects, for `nina eval` to review release against release
scripts/              this repo's own drift detectors
~/.nina/snapshots/    measured pipeline history (NOT in the repo — see docs/installing.md)
```

## Working in this repo

Work directly. There is no subagent pipeline here — this repo *produces* one, it does not run
one. Dispatching planner → architect → implementer for a CLI change is exactly the over-gating
the harness calls a failure.

The repository is public at github.com/xhulz/nina, and its `main` takes changes only through a pull
request: work on a branch, push it, open the PR, rebase-merge it. Never force-push. The history from
before the source was published is not part of this repository and must never be pushed to it.
