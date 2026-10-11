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

A project that has not made a decision yet can say so. A vocabulary name, an owed document, an
integration's doc or a project slot named under `"deferred"` in `.nina/profile.json`, with the reason it
waits, is a note rather than a problem:

```json
"deferred": { "AUTH_LIB": "the auth library is Open in architecture.md §7", ".claude/code-map.md": "no code yet" }
```

The first new project designed for days before it had code, and every message of its owner's came with the
same five problems, three of them decisions its architecture marked Open: a check that always fails is one
nobody reads. A deferral with no reason counts for nothing, one that names nothing the check asks for is
said to be stale, and `upgrade` does not ask for a deferred name. `compose --check` reads the same
deferrals, through the same `deferredWhy`: it once read none, and a new project's root
`harness:compose:check` failed on six slots it had deferred while `check` was clean. A deferred name composes as
`[AUTH_LIB: not decided yet]`, so a stage that meets it asks rather than reading a raw placeholder as a
slip to work around.

An integration is checked both ways. A declared one must have its doc at `.claude/integrations/<slug>.md`, and
a doc there that no integration declares is a note: a project kept one for the library it replaced, as the
record of why, and one for a boundary a later plan creates, and from the profile nobody could tell either from
a declaration that was forgotten. The same `"deferred"` says which, with its reason —
`".claude/integrations/prisma-d1.md": "retired: Prisma was replaced by Drizzle"` — rather than a second list
for the same decision. A doc whose premises cite a path into the package manager's store that the install no
longer uses is a note too, with the first such path. The store's directory names carry a suffix for each peer
dependency: in one project, adding `@types/node` renamed the directory of every package that peers on it, the
versions and files byte-identical, and the old directories stayed on disk linked by nothing — so the citations
still opened on the machine that wrote them, and 12 of the 31 store paths its specs and docs cited pointed nowhere
a fresh install looks. A store path is therefore stale when its file is gone, or when its directory is not among
those the install reaches: the ones the root and the packages two levels down link, and every one those link in
turn. A transitive copy still in use is reached, a renamed one is not — the walk found a second library renamed
by the same peer, used only from inside the first — and a spike's own store answers only for its own paths. Only the integration docs are read, the
premises that outlast a task; a spec's citations are the integration-tester's to refuse when it runs. Only store
paths, too: a path through a package's link, or one written from some package's directory, cannot be told stale
from here, and a template, an elision, a URL and a mention that names no `<name>@<version>` directory (`resend@*`
does not exist) are not citations; the store's own hoisting `node_modules` is judged by the file alone. On the
first two projects it ran in, every path it named was a version or a hash the install had moved past. A premise now cites the package's own link
(`<package dir>/node_modules/<lib>/<file>:<line>`, the version beside it), which a peer change does not rename.

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

## One screen: `nina status`

The question a person brings to a project — is its harness in order, and is it current — took six
commands to answer. `nina status` answers it on one screen: the release the project pins, the NINA it has
installed and the newest on the registry (asked for three seconds, skipped with `--offline`), whether every
hook its release needs is wired, what `gate --selftest` and `check` conclude, how fresh its measured history
is and what the last seven days cost at API list prices, and its pills and open requests. Each line reads
what its own command reads, or runs it, so the screen cannot disagree with them; it exits 1 when any line
needs looking at, and names the command that deals with it.

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
sends work on a condition, followed to a terminal. A stage the graph declares `× many` carries `×n` on the
line, and a legend says what its agents split: steps that share no file, for the implementer. Below them,
what each stage sends back, to whom, on which verdict and with how many rounds per issue. Then each stage
with its model and effort level from its spec's frontmatter, its skills as `nina check` reads them, what it
does in the graph's words (shorter than a `description:` written for Claude Code to choose an agent by),
and what it did lately: its runs over the last thirty days in the measurement store (`--since` moves the
start), and how many of the verdicts that could be read sent work back. A dispatch a hook denied never ran
and is not counted. An agent the project wrote for itself is listed apart, since the graph does not route
to it. Last, the task shapes of `CLAUDE.md`'s chain table, numbered, each with the chain it takes.

`--for` draws one shape's chain alone, named by its number or by words that all appear in it: its stages,
the add-ons any chain may take (a row whose dispatch runs no chain of its own, such as
`+ dba before reviewer`), and only what goes back among its stages. Words that match more than one shape
list the ones they match.

## Watching it work: `nina pipeline --view`

```bash
nina pipeline --view --project ../thing             # live: the newest session, as the gate records it
nina pipeline --view --replay --session 85d7        # one session played from its first dispatch
nina pipeline --view --open                         # the system's browser opened on it too
```

The same graph as an office seen from above, in pixels: a floor plan with a room for each phase — design, build,
review and the gates, the test lab, release — off one corridor, a desk for each stage in its room (two for a stage
that runs as several agents), the orchestrator — NINA, drawn as a woman facing the room — at the reception, the owner
as the phone on its counter (they are not drawn: they are watching), a garden outside the
door new agents come in by, and each agent the loop gate saw launched sitting at its stage's desk. It
reads the gate's ledger, so it shows what the ledger holds — who worked, what they answered, the ids of the issues
they named, the few words the orchestrator gave each dispatch — and never what an agent wrote or reported. A dispatch is someone sitting down to work, the
folder carried over by whoever handed it on along an edge of the graph (a diff to its reviewer, a rejection back
in red to its fixer) and by the orchestrator otherwise; whoever handed it on then leaves, and everyone else whose
report is in gets up as the work moves on, so the room holds the work in hand and not everyone who ever sat in it.
The title says who is at work, or that the room waits for the next dispatch: between dispatches, little moves. A verdict is a check or a cross over their head; a verdict
the graph sends to `human`, or the orchestrator asking, a question mark until the owner answers or speaks; the gate
asking at a cap, the reception's phone ringing until the dispatch goes out, is refused, or the owner speaks. Whoever sat
down for a dispatch the owner refused, or for a run that never reported within three hours (the longest of 227
measured took 108 minutes), gets up and leaves; neither keeps the work from ending. A pass is a party when nothing since the last dispatch was sent back,
something since then could route to `done`, nobody is still at work and no dispatch follows within twenty seconds
— at once when the pass routes only to a terminal. The quiet is there because qa's pass may still go on to devops,
and the orchestrator commits before it dispatches; without the rest, a reviewer approving beside a dba that was
about to reject threw a party.

Beside the room, a timeline of the session's tasks, newest first — the visibility the owner asked for, without the
detail: each task's name, who worked on it (each stage in the order it first did, and how many times it was
sent), when it started and ended, and how long it took; a task still open counts up while anyone is at work on it,
and stops at the last thing that happened while nobody is. A task is a cycle, cut as `nina runs` cuts one
(`cyclesOf`, one function for both): a session's dispatches up to the verdict that closes them, named by the words
the orchestrator gave the first. The gate keeps those words on each dispatch's entries; a ledger written before it
did takes them from the measurement store, by the dispatch's id, read again only when the store has changed. A task
that waited — overnight, on the owner — also says how long anyone was at work on it: its runs' spans joined, so runs
side by side count once. The list is cut again as the ledger grows and sent whole whenever it changes, and the page
replaces what it has: the cut moves — a review still at work lets nothing through until its verdict, a refused
dispatch is known only once the orchestrator goes on — and sent task by task, a task a later fact merged away stayed
on the page running for ever. A replay sends it as it stood at each beat, cut from the ledger up to that beat. On a
narrow window it is drawn over the room and starts hidden; the `tasks` button, or `t`, shows or hides it, and the
viewer's browser keeps the choice.

It is a page served on the loopback address for as long as the command runs, on port 6462 (NINA on a phone's
keypad) or any free one, and the command prints its address at the end of a line, where a terminal makes it a
link: whoever wants to watch clicks it. VS Code's own browser opens a page only for an extension or for a click,
and an extension is not NINA's to install in anyone's editor; with `workbench.browser.openLocalhostLinks` on
(1.140), the click opens it beside the conversation. `--open` opens the system's browser on it too, and says so
only when the opener did, which a machine with no display does not. A Claude Code mod was the first idea and
was probed before a line of this was written: in the editor's chat panel Claude Code runs a mod's hooks, but its
session reports no surface to draw on and no drawing is ever asked for — a mod draws in the terminal and the
desktop app only.

The view starts at two and a half screen points an office pixel, closer than the whole office when the window is
smaller than that: fitted whole into a window beside the conversation, a person came out under twenty pixels tall.
Closer than the whole, it follows the work — the folder as it is carried, the desk of whoever reports, the
reception for a question. Dragging, the wheel and a pinch take it over until the viewer has left it alone for
twelve seconds, or double-clicks; `+`, `−`, `0` and the buttons zoom without taking it, around what it follows. The
zoom chosen is kept by the viewer's browser. Names are written at the screen's resolution, at eleven points or
more — smaller only to fit on a desk when the whole office is squeezed into a small window — and a stage's name
stands above its desk's screen: on the desk's front, it hid the head of whoever sat there. The session is picked as `gate --status` picks it, through the same function.
Live, a client is handed what came before it connected at once, to set the room by — the room it sets holds only
the work still in hand and the reports since the last dispatch, since a session's hundreds of finished runs, walked out one by one, were a crowd running
for the door — and then each beat as the gate
writes it; a replay plays one session from its first dispatch with its gaps shortened, the owner's messages passing
quickly; moving to a session that was already running, what it did before the move sets the room rather than
playing out again. The orchestrator's question reaches the ledger only because the gate's `PreToolUse` hook also
matches `AskUserQuestion` — the moment it was asked and the moment it was answered, nothing it said. A project wired
before that has the hook narrower than it needs: `check` names the tool it does not match, `upgrade` says so without
stopping the move, and `nina wire --apply` widens it in place — but a group matched by a regular expression, or
kept in the local settings file, is its owner's to widen, and both say so instead. The page answers only to this machine's own names
for itself, on any port a forwarding gives it, so a page elsewhere that rebinds its domain to the loopback address
is refused.

## Every report in one page: `nina dashboard`

```bash
nina dashboard --project ../thing [--port <n>] [--open]
```

The reports a person reads, a tab each, in a page on this machine, its address printed for a click the way the
office's is: **Office** (the office itself, mounted at `/office/`), **Tasks** (`runs`: each cycle with who worked on
it, its length and cost), **Pipeline** (`pipeline`: the line, its gates, who sends work back and how many rounds per
issue, each stage's model, skills and what it ran), **Pills** (`pills`: every pill with its stage, count and trigger,
then the problems, and the notes folded), **Learning** (`learn`: the five links, the requests, what came back after
graduating, the before and after of each lesson) and **Stats** (`stats`: the stages, the cost, the context and the
size of each change against its chain). A tab is read again every fifteen seconds while it is open; the office
streams on its own.

The commands stay. The project's hooks run `pills`, `learn --check` and `compose --check` every turn and hand what
they print to the model, CI runs them, and an agent asked how a project is doing reads `nina runs` or `nina stats` —
a page it cannot read. So nothing on a tab is counted for the page: each is served from the function its command
prints from — `taskList`, `pipelineData`, `pillsData`, `learningData`, `statsData` — split out of the report that used
to compute and print in one, its text output left byte for byte what it was. A second copy of a count is what this
repository has shipped drifting more than once. The learning tab reads the store as it stands, where `nina learn`
takes a snapshot first: the project's hooks take one every turn, and a snapshot every fifteen seconds would read the
transcripts that often. Each tab is trimmed to what it draws — no record, pill or report goes out whole — and every
text goes into the page as text, never as markup.

It is served the way the office is, through the same functions (`src/serve.mjs`): the loopback address, port 6463 or
any free one, a request naming another host refused, `--open` for the system's browser. The office's poll of its
ledger starts when its tab is first opened. `nina help` lists the commands a person runs from day to day, the
dashboard among them; `nina help --all` lists the rest — measurement and maintenance, most of it drawn better here —
and every command still runs by name.
