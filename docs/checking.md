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
A path in a fenced block is not read: it is what a command printed, quoted as evidence, and one project's
`readlink` transcript held a store directory renamed since — a note that could be cleared only by falsifying
the evidence, on every run, which trains its reader to skip the notes that are right.

A library no package links has no such link: with a store that links each package's direct dependencies only,
the emulator every database premise of one project was about is a dependency of the CLI and of the test plugin,
and the only path to its files was the store directory a peer change renames. It is cited through the link of
the one that depends on it — `<package dir>/node_modules/<parent> → <lib>@<version>/<file>:<line>` — and `check`
resolves it as Node does, from where the parent's link really leads: the library found from there, at the
version written, with the file in it and the line within it (the line read as `nina pills` reads a pill's
citation). One that does not is a note, with why.

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
review and the gates above one corridor, the reception, the test lab and release below it — desks for each stage in its room, the orchestrator — NINA, drawn as a woman facing the room — at the reception, its counter labelled orchestrator, the owner
as the phone on its counter (they are not drawn: they are watching), a garden outside the
door new agents come in by, and each agent the loop gate saw launched sitting at its stage's desk. It
reads the gate's ledger, so it shows what the ledger holds — who worked, what they answered, the ids of the issues
they named, the few words the orchestrator gave each dispatch — and never what an agent reported; of an agent's own
transcript, the timeline below reads only its context and its current step. A dispatch is someone sitting down to work, the
folder carried over by whoever handed it on along an edge of the graph (a diff to its reviewer, a rejection back
in red to its fixer) and by the orchestrator otherwise; whoever handed it on then leaves, and everyone else whose
report is in gets up as the work moves on, so the room holds the work in hand and not everyone who ever sat in it.
One whose report is in waits two minutes for its work to be handed on, and then goes home; handed on later, the
orchestrator carries it. One that asked the owner stays with its question until the work moves on. Waiting for the next dispatch alone, with tasks side by side, 346 of the 1,266 reports
measured across two projects sat on past two minutes and 149 past ten, done and with nothing in hand, while Claude
Code had already let them go; of 544 hand-offs, 92.8% went out within two minutes, and only 93.9% within three.
The title says who is at work, or that the room waits for the next dispatch: between dispatches, little moves. A verdict is a check or a cross over their head; a verdict
the graph sends to `human`, or the orchestrator asking, a question mark until the owner answers or speaks; the gate
asking at a cap, the reception's phone ringing until the dispatch goes out, is refused, or the owner speaks. Whoever sat
down for a dispatch the owner refused, for a run the orchestrator stopped (`TaskStop`, which the gate writes to the
ledger), or for a run that never reported and has gone quiet, gets up and leaves; none keeps the work from ending.
The stop was read first by the clock alone, and one project paused for an upgrade had an implementer it stopped sit at
its desk for the rest of the afternoon, holding off the party of the step another implementer finished. A run is quiet
when its own transcript — found by its agent, or before the gate knows that, by the launch its `.meta.json` names —
has not been written for 45 minutes: the longest silence inside a run, in 299,030 measured across three projects, was
20. A run whose transcript cannot be read goes by the clock, three hours from its start (the longest of 227 measured
took 108 minutes). The clock came first, and an implementer three hours into a step, still writing, got up and left
the office until the orchestrator sent it a message. Time the machine spent asleep is no silence: a look at the ledger
a minute or more after the last counts a run's quiet from then. A replay reads the transcripts as they are now. A pass that closes a task — the verdict that ends a cycle of the timeline
below, qa's `PASS`, devops' `DEPLOYED`, secops' `SECURE` — is a party at once, whoever else is at work: held to an
empty office, a day of tasks side by side in worktrees closed 25 and had one party. A change that goes on to devops
has two, since the timeline closes a task at its qa and another at its deploy; a pass reported beside the one that
closed a task throws no second. Any other pass is a party when
nothing since the last dispatch was sent back, something since then could route to `done`, nobody is still at work
and no dispatch follows within twenty seconds — at once when the pass routes only to a terminal. The quiet is there
because a pass the graph lets end the work may still go on, as a spike's approval may to qa; without the rest, a reviewer approving beside a dba that was about
to reject threw a party. Once the cheering ends, everyone whose report is in goes home, and whoever is still at work
stays: a room left holding the last to report read as someone still at work.

A stage gets as many desks as the gate's ledgers — the thirty days it keeps — ever had its agents at work at once,
from each run's start to its verdict or stop: two for a stage the graph declares `× many`, one at least, eight at
most. One desk each, and two for `× many`, came first; the ledgers then held reviewers split by axis of risk three and
five at once, and a day of worktrees four qa runs and eight implementers, and whoever found every desk of their stage
taken worked standing beside it. A run that never reported is not counted. The room is measured when the office
starts, so a busier day than any before still stands until the next start. The test lab's rack and release's shelf
stand in a column of their own past the last desk: in the room's far corner, a fourth desk stood under them.

The floor is laid out for the window it is drawn in. Each row of rooms puts its desks in as many rows as make the
whole office come out largest there — a wide window gets long rooms side by side, a narrow one deeper rooms — and lays
itself out again when the window, or the timeline beside it, changes that; whoever sits, stands or walks keeps their
place in it. The rooms stood in two columns, three deep, off a corridor down the middle, four desks a row: once
stages got the desks they ran at once, a project's office came out taller than wide, and fitted whole it stood small
in the middle of a wide window — people watching it asked whether it was working, not seeing the agents. Side by side,
the same desks on a window 1440 points wide, beside the timeline, came out 2.13 points an office pixel rather than 1.82.

Beside the room, a timeline of the session's tasks, newest first — the visibility the owner asked for, without the
detail: each task's name, who worked on it (each stage in the order it first did, and how many times it was
sent), when it started and ended, and how long it took; a task still open counts up while anyone is at work on it,
and stops at the last thing that happened while nobody is. A task is a cycle, cut as `nina runs` cuts one
(`cyclesOf`, one function for both): a session's dispatches up to the verdict that closes them, named by the words
the orchestrator gave the first. The router asks for those words plain, then the step's id short (`router.md` § *A
dispatch is named for whoever watches*): written as the plan's ids alone — `M2 15b/15c spec fix`, `10e round 2:
controls and rows` — they told the owner watching the office nothing of what any agent was doing. The gate keeps
those words on each dispatch's entries; a ledger written before it
did takes them from the measurement store, by the dispatch's id, read again only when the store has changed. A task
can begin with a message — an agent resumed after it had reported, a design-reviewer sent to re-check a corrected
spec after qa closed the last task — and a message has no description: it is named by its `summary`, which the gate
keeps the same way, else by the words its agent was launched with. Before, such a task was named nothing. A task
its closing verdict ended stays open while one of its runs is still at work: work planned side by side — three
architects sent together, one of whose specs went on through code and qa — fell inside the task that qa closed, and
the room showed two architects at work beside a list with no task open. A run stopped or gone stale holds nothing. A task
that waited — overnight, on the owner — also says how long anyone was at work on it: its runs' spans joined, so runs
side by side count once. The list is cut again as the ledger grows and sent whole whenever it changes, and the page
replaces what it has: the cut moves — a review still at work lets nothing through until its verdict, a refused
dispatch is known only once the orchestrator goes on — and sent task by task, a task a later fact merged away stayed
on the page running for ever. A replay sends it as it stood at each beat, cut from the ledger up to that beat.
Under a task still open, each of its agents at work, oldest first, as Claude Code lists its own: the stage, what it is
doing now, the words its own dispatch was given, how long it has been at work, and how much context it holds (its
newest message's). What it is doing is its newest tool call: the description it gave a shell command, which it writes
for a person to read, or the tool and the name of the file it works on — never the command, the file's path, a pattern,
another tool's input or what came back. Claude Code leads its line with words a model writes as it watches each agent, and
keeps them nowhere, neither in a transcript nor among the requests it logs, so the office reads the step itself: the
dispatch's words alone, shown first, read beside Claude Code's list as the wrong names. Both are read from the run's own
transcript as it grows, and nothing else of it is kept; a replay is told them as they stood at the beat. A task open
with nobody at work counts up to the last of its own runs to start or end, not to another task's work. On a
narrow window it is drawn over the room and starts hidden; the `tasks` button, or `t`, shows or hides it, and the
viewer's browser keeps the choice.

The `dark` button, or `d`, turns the building's lights down for watching it at night, and `light` turns them up again:
the floors, walls, furniture and garden go dark, and what is lit stays lit — a screen someone is at work on, the rack's
lights, the names, the people. The office by day, bright floors and cream walls, was hard to keep open beside a dark
screen at night. The building takes every color it is drawn in from one palette, so night is the same drawing in
another; the viewer's browser keeps the choice, and the office opens by day until one is made.

It is a page served on the loopback address for as long as the command runs, on port 6462 (NINA on a phone's
keypad) or any free one, and the command prints its address at the end of a line, where a terminal makes it a
link: whoever wants to watch clicks it. VS Code's own browser opens a page only for an extension or for a click,
and an extension is not NINA's to install in anyone's editor; with `workbench.browser.openLocalhostLinks` on
(1.140), the click opens it beside the conversation. `--open` opens the system's browser on it too, and says so
only when the opener did, which a machine with no display does not. A Claude Code mod was the first idea and
was probed before a line of this was written: in the editor's chat panel Claude Code runs a mod's hooks, but its
session reports no surface to draw on and no drawing is ever asked for — a mod draws in the terminal and the
desktop app only.

The view starts at two and a half screen points an office pixel, closer than the whole office unless the whole fits
at seven tenths of that or more: fitted whole into a window beside the conversation, a person came out under twenty
pixels tall. At the old 85%, a room with the desks its
stages ran at once grew a project's office from 376 pixels tall to 468, and a window that had shown it whole opened
close, following the work, so that it read as a page to scroll.
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
then the problems, and the notes folded), **Learning** (`learn`: whether the lessons helped, in a line, then the
links, the before and after of each lesson, the requests and what came back after graduating) and **Stats** (`stats`: the stages, the cost, the context and the
size of each change against its chain). A tab is read again every fifteen seconds while it is open; the office
streams on its own.

The commands stay. The project's hooks run `pills`, `learn --check` and `compose --check` every turn and hand what
they print to the model, CI runs them, and an agent asked how a project is doing reads `nina runs` or `nina stats` —
a page it cannot read. So nothing on a tab is counted for the page: each is served from the function its command
prints from — `taskList`, `pipelineData`, `pillsData`, `learningData`, `statsData` — split out of the report that used
to compute and print in one, its text output left byte for byte what it was. A second copy of a count is what this
repository has shipped drifting more than once. The learning tab reads the store as it stands, where `nina learn`
takes a snapshot first: the project's hooks take one every turn, and a snapshot every fifteen seconds would read the
transcripts that often. A tab carries what its command prints — a pill's name, stage, count and trigger, the notes
and problems `nina pills` lists, the words the orchestrator gave a dispatch, each stage's words and the task shapes
`nina pipeline` draws — and never a pill's body, a report, a prompt or a whole record; nothing leaves the machine. Every text goes into the page as text, never as markup.
The learning tab reads verify as comparisons, not lessons: lessons of one stage written the same day are measured over
the same rounds, and a row each repeated one comparison's numbers — fifteen rows, five measurements, and whoever read
them could not tell whether anything had got better. Each comparison is one card, its lessons under it, above it the
answer in a line, and beside the before and after the days each side covers and the other stages over them.
A tab that fails to read says why in the terminal running the dashboard, and the page gets only that it failed: the
error's message carries the project's paths and its stack the code's (CodeQL's `js/stack-trace-exposure`).

It is served the way the office is, through the same functions (`src/serve.mjs`): the loopback address, port 6463 or
any free one, a request naming another host refused, `--open` for the system's browser. The office's poll of its
ledger starts when its tab is first opened. `nina help` lists the commands a person runs from day to day, the
dashboard among them; `nina help --all` lists the rest — measurement and maintenance, most of it drawn better here —
and every command still runs by name.
