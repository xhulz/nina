# Measurement, and evaluating a release

What the transcripts say the pipeline did, what it cost, and whether a release's reviewer catches more. Read before touching `src/transcripts.mjs`, `src/commands/snapshot.mjs`, `src/commands/stats.mjs`, `src/prices.mjs`, `src/commands/eval.mjs` or `evals/`.

## Measurement

The CLI also reads Claude Code's own transcripts under `~/.claude/projects/` to measure what
the pipeline actually did — which stage ran, what verdict it declared, how often it sent work
back.

```bash
nina snapshot    # append new dispatches to ~/.nina/snapshots/<project>.jsonl
nina stats       # loop-back rate per stage, what each stage costs, how the size of a change sat
                 # against its chain, and what the pipeline learned
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
which skills were invoked, how many pills the run opened, how many issues a loop-back named, how many
distinct files the run wrote, the tokens the run spent by kind with the model that spent them and the effort
level it ran at, the release the project pinned when the round was captured (`core`) and the Claude Code that
ran it (`claude_code`). No report text, no source, no PII, not even a pill's path or an issue's id — and no
dollars: a price is a fact about a date, so `stats` prices the tokens when it reads them, at the list prices
in `src/prices.mjs`, and says which date's.

One field is text a model wrote: `desc`, the three-to-five-word description the orchestrator gives a
dispatch. It is what names a cycle in `runs` and a loop-back in `learn`, so it is kept — and kept on this
machine: nothing sends it to Langfuse, and the store is written readable by its owner alone (`0600`).

A round records `core` when it is first captured and keeps it: a rebuild does not stamp today's pin on weeks
of history. So a rule is judged only on the rounds that ran under it, and rounds captured before the field
existed are left out of what a rule is judged on rather than read as breaking it.
Those are API-equivalent figures; a subscription pays nothing per token, and the unit is still the
right one for comparing one stage with another. Keep it that way.

The first reading, over one project's 825 runs: the implementer was 41% of the spend at a median of
$2.40 a run, the architect 26%, and the dba — the gate whose rate of sending work back had been in
question for weeks — 2%, at $0.40 a run. A stream counted per row would have read the same message
three or four times over: Claude Code writes a streamed message once per content block under one id,
so each message is counted once, at its final usage. A run's transcript is read again whenever it has
grown since the last read: 14 in 1,389 were resumed after they reported, with a median 42% of their
tokens and their final verdict written after the first handback. `usage_model` is the model that
actually spent the tokens; the record's older `model` is the one the dispatch asked for, which is the
orchestrator's own when it named none. A fast-mode or fallback run is left unpriced rather than priced
as the model it names.

`stats` also sets the size of each change against the chain that carried it — the core's first hard
rule, which nothing had measured. A cycle is a session's dispatches up to the verdict that closes one
(qa `PASS`, devops `DEPLOYED`, secops `SECURE`), or up to the next design stage after code was written
and let through — a stage that reviews read the latest write and nothing since sent work back; a closing stage whose
verdict cannot be read closes it too, and is counted. Read off the one verdict dispatched before the design,
as it first was, the gates that run side by side made the boundary depend on which went out last: a rejection
beside three approvals ended the change its own fix belonged to, and so did a fix sent out together with its
spec's correction. The same cut names the tasks in the office's timeline (`docs/checking.md`). It is sized by the most files any one writer wrote in it — through the edit tools, so a
shell-written file is missed and the size is a floor — and the report is a distribution rather than a
list of violations: a critical path is gated in full at any size and cannot be seen in a file count,
and one spec legitimately covers sibling steps. Two boundaries were wrong before this one. The owner's
prompts gave 22 "undesigned" large changes of which 18 came right after a spec — every "pode seguir"
cut a pipeline in two. Closing stages alone left the light chain, which has no qa, to be absorbed by
the design that followed, and let a qa with no readable verdict hold a dozen pipelines in one cycle:
that reading said all four small changes had been designed. The reading that survived, over 132 cycles:
5 of 8 one- and two-file changes ran a planner or architect, 62% of the three-to-nine-file ones did, and
84% of those of ten files or more — with 29 cycles closed by a qa whose verdict could not be read.

That is a shape, and the one size the harness does limit is narrower: what one implementer run writes.
The first project started from nothing specified a spike as one 49-file step; one implementer wrote it in
a single 68-minute run and read 357M tokens from cache. Over the implementer runs of both projects, the
cache read per file held near 1M up to 19 files (0.9M at one to three, 1.1M at ten to nineteen), was 2.6M
at twenty or more, and 6.9M in that run: a run re-reads the context it has built on every turn, so its
cost grows faster than its size, and in the implementer 76% of the spend is cache read. So the architect
splits a spec past `{{STEP_FILES}}` files (15 by default) into steps, each in its own file, the
orchestrator runs each step as its own pass from the implementer on, and an implementer handed more
returns `BLOCKED`. `stats` names every implementer run past the limit its project's release states, with
the largest and what it read, and says nothing for a release that states none.

Files were not enough. A step of three files that its parent spec put at about 640 lines came to 2,546 in its
first round and 3,560 in its second; under the file limit, it was the step every gate read in full, twice. So a
step is also held to about `{{STEP_LINES}}` lines (400 by default), tests and fixtures included: the architect
forecasts both for each step and splits past either, and the snapshot keeps each round's `lines_written` — a file's
last whole write and each edit's new text after it, through the edit tools. That is what the run wrote, not its
diff: an edit made twice counts twice, which is also what the run paid for, and a file a shell command wrote is not
counted at all. That last was most of them in the project the rule came from: its implementers edited through
`python3` heredocs, to keep escapes the edit tools decode, in 55 of 61 rounds, and 9 of those made no edit-tool call,
reading as 0 lines. So the snapshot also keeps `shell_writes`, how many of a round's shell commands wrote a file
outside a temporary directory (`writesThroughShell` in `src/transcripts.mjs`): each simple command placed where it
lands — the redirect's file, a `cp`'s destination, where the command stands after its `cd`s, a variable it bound — and
one whose place it cannot know left out. It is a sign, not a count: a script run from a file is missed. `stats` names
the runs past the line limit the same way, asked only of a project whose release states it, and calls a round under
it that wrote through the shell not measured rather than small.

Each step names the steps it builds on, and those whose turn comes together and share no file go out at
once. That buys time and not tokens: each run builds its own context, and the one project that ran two at
once paid no less per file than its serial runs that week. The first version sent them out only one per
package, each in a worktree, the rule implementers already had, and the first new project met both halves
of it. Its second spike's steps 3 and 4 built on steps 1 and 2 and nothing else, and ran one after the other
for about two and a half hours only because they shared a package and a README. And it had no commit, and a
worktree holds only what is committed: with none it is empty, and work not yet committed is not in it. So
it ran two implementers of two spikes side by side in one checkout, against the rule, and neither disturbed
the other. Now implementers in different packages, each checked on its own, run side by side in the
checkout; within one package each gets a worktree, once the work they build on is committed; and a file
every step would edit goes in one step, so it orders nothing else.

What every step reads is the spec, which is why the architect is told to say each thing once: the spike's
spec was 156 KB where the other project's had a median of 40 KB, only 10% of it code, and it opened with
four revision sections from the rounds it was sent back through, which every later stage read before the
spec itself. Telling the architect was not enough. The orchestrator kept asking for revisions and wrote one
itself, and a later spec reached its eighth as the way new work was asked for, so the router now tells the
orchestrator too: a spec is corrected in place, new work is a new step or spec, and a dispatch names the
sections that changed.

On a terminal `stats` is drawn: each section marked in the banner's pink, each stage's runs as a bar of
what went forward, what was sent back and what said nothing readable, each stage's share of the cost as a
bar, and every sentence under a section marked `!` when it needs looking at, `✓` when it is sound and `·`
otherwise, wrapped to the window. Piped, it is the same lines without colour or wrapping, so `grep` finds a
whole sentence and the suite reads it; the bars stay, since a block character reads the same anywhere.
`src/look.mjs` holds how it looks, and `nina pipeline` draws with the same.

`stats` reports the projects that run the harness: one whose directory holds `.nina/profile.json`, or
failing that one with ten pipeline dispatches, which is how it was told before profiles existed. Counted
by dispatches alone, the first new project, five dispatches in, was hidden among the projects that do not
run it. Run inside a project, it reports that project only, and says so, because the store holds every
project on the machine and that project's owner read six weeks of another's history as its own; `--project`
names another, and `--all` reports every project in the store, harness or not. A learning share over 100%
is not printed: more pills than loop-backs means the pills answer something else.

The measurement store is the only copy of history older than Claude Code's transcript retention, so a
snapshot must never make a record worse. A dispatch already on record is never re-created, and a
notification already read is not read twice — re-walking bytes after a cursor went back used to blank a
record and count a resume that never happened, and once the snapshot wrote whenever a record changed,
it wrote the blank over the good one. Claude Code 2.1.282 made the same mistake easy twice over. It writes
one notification up to three times (queued, then taken off the queue or absorbed mid-turn, and delivered as
a message), each at its own time, so a copy is told from a resume by the agent's usage block, whose time a
resume has made longer. And when the run handed its report back, the notification says only that the
report was delivered and is not repeated. Read as the report, it replaced the verdict the handback
declared with none, on three of the first new project's runs in an afternoon, and nothing read their
unchanged transcripts again. A notification now never replaces a handback's verdict, and a run whose
recorded verdict is not its handback's is read once more. A project is snapshotted by one snapshot at a time. Its own detector and a global hook both snapshot on
every Stop, and records and cursors are two writes: interleaved, the cursors of the scan that read further
could stand beside the records of the one that read less, and what lay between was never captured. A
snapshot that finds the project's lock taken leaves it to the one holding it; a lock left by a snapshot
that died is taken over, by one taker only (`src/lock.mjs`, the export's lock too). The first lock was created
empty and written after, and a dead one's was removed by every taker that read it: racing eight processes,
two held it at once in half the runs. `--rebuild` keeps the record it replaces beside it
(`<project>.jsonl.before-rebuild-<time>`), since it re-reads only what is still on disk. Cursors live beside each project's records, written by rename:
one shared file, rewritten whole by every project's hook, let the later of two concurrent writers put
every other project's cursor back.

The lesson counts were added to the record after 826 dispatches were already captured. Those were filled
in from their transcripts on the next snapshot, without `--rebuild` — a rebuild re-reads only what is
still on disk, and Claude Code prunes old transcripts, so it would have dropped every record older
than the retention window. A record whose transcript is gone keeps what it had.

This half exists because every rule the harness could not enforce was invisible until
measured: mandatory skills were invoked 2 times in 743 runs before anyone counted.

### Runs and rounds

A record is a **round**: one pass of an agent that ends in a report. A **run** is the agent, from the Agent
call that started it to its last report, and has a round per report — the dispatch, and each `SendMessage`
that resumed it after it reported. The first round is recorded under the dispatch's id, each later one under
that id with `#<round>` after it, and `runOf` in `src/transcripts.mjs` gives the run of either.

A run used to be one record holding its last verdict. The orchestrator resumes the same reviewer, architect
and implementer through every fix, so a reviewer that rejected twice and then approved was one approval: over
the first new project's first two days the loop gate's ledger held 34 loop-backs where the snapshot held 5,
and `stats` read the reviewer as sending back 20% of its work where it sent back 57%. It also timed the first
round to the resume's notification, stretching it across every hour the agent sat waiting. The gate had
always counted rounds, so two mechanisms disagreed about one fact.

Where one round ends is read from the agent's own transcript, where a resume is written as a message: a round
ends at the run's handback, and the next opens with the next thing said to the agent — not a reminder, not a
tool's result. A message that reaches the run before it reports is part of the round it is in, and one it has
not answered yet is not a round. `roundsOf` is that rule, and the snapshot, the context sent to Langfuse and
`learn --deep` all read rounds through it. Each round keeps its own verdict, time, spend, files, skills and
lessons read, so every report counts rounds without knowing a run can have several, and asks of runs only
what belongs to one: `stats` prices a run as the sum of its rounds and asks whether it invoked a skill, and
`learn` whether it read a lesson, since what a run read in its first round is in front of it in every round
after. A run captured whole before rounds existed is split on the next snapshot while its transcript is on
disk; its later rounds are marked `backfilled`, and one whose first round already went to Langfuse whole is
not sent, since its tokens would be counted twice.

A round with no report is still running for three hours after it started — the longest measured took 68
minutes — and after that it never reported, or its report could not be found. Those two used to be counted in
neither the verdicts nor the unreadable ones, so a change in Claude Code that hid every report would have
left `stats` saying every verdict could be read. They are unreadable now, and `stats` says how many there are
apart from the reports that lack a verdict line, since the two have different causes.

A run from before the handback existed has no report in its own transcript, so "read in full" could never be
said of it, and every snapshot read it again: one project's 744 such runs, two seconds before the person saw
an answer on every turn. A run is read again now only when its transcript has grown, or when a round that
handed its report back holds a verdict from somewhere else, or when a reader from before rounds marked it
read. That reader writes `resumes` and bills the whole run to its first record; a store one project's old pin
and a newer hook both wrote to had those runs skipped as read, their first round billed twice.

### How a round spent its context

Every turn is billed the whole context again, so what a round costs is its turns times the size of what
each re-read, and a count of tokens alone cannot say which grew. Each round keeps its `turns` (API messages),
its `tool_calls`, the context a turn re-read when it began (`context_start`) and at its largest
(`context_peak`), and the length of the prompt that opened it (`prompt_chars`), counts only. `stats` sets each stage's first rounds beside its resumed ones, and `nina runs`
names the largest context a cycle reached.

The first reading, over the first new project's 128 rounds, is where two rules came from. A resumed
implementer began its fix at a median 484k tokens of context and took a hundred turns, twice a first round's
spend, and resumed rounds of the implementer, architect and integration-tester held three quarters of all
the pipeline read; so the router sends a round of real work to a fresh run, dispatched with the spec, the
findings and the files they name, and resumes a run only for something short. And turns sent 1.00 to 1.05
tool calls each, while runs re-read files they had just written 534 times; so Hard Rule #19 asks that
independent calls go out together and each thing be taken in once. Both are measured by the same columns.

The rule did not move the number. The third project's implementers sent 1.15 calls a turn; one step's two rounds
took 92 and 106 turns, every one a single call, and the model's own time between calls was 37 of 40 minutes and 35
of 63 — the commands ran for the rest. Their named mutations were run one call each. The implementer and qa now run
every mutation from one script that prints a line each, which makes the largest run of single calls one turn.

One script was not the end of it. The first round under that rule generated 2,536 mutants from the code, as a
lesson of that project asks of a check, and ran them one at a time, near a second each; the round spent 66 of its 92
minutes polling the battery with `sleep`, on a machine with ten cores. The implementer's mirrors are plain `node`, so
a battery that large now runs side by side, a worker per core less two, each on its own copy, and the run waits for
it in one call. qa's mutations stay one at a time: each runs the suite, at about 2 GB a process.

The implementer was not the only one. That step took 4h37 to close: after that round, the integration-tester the spec
sent to repeat the fuzz spent 43 of its 81 minutes in fuzz commands of nine and ten minutes, run one case at a time,
and the three reviewers, who had rejected the change by 11:02, waited on it until 12:10 before the fix could go out.
So the rule moved into Hard Rule #19, which every stage reads: a battery, a fuzz or a differential check of many light
cases goes side by side, a quarter as wide for a gate, since the gates run together, and waited for in one call. A
case that boots a runtime, a database or a browser runs alone, as the suite does: each holds about 2 GB.

### What a piece of work cost: `nina runs`

`stats` answers per stage over a window, which is the question for a gate and not the owner's, which is
what a feature, a spike or a fix came to. `nina runs`, inside a project or with `--project`, lists its
cycles newest first — the unit `stats` sizes, a session's rounds up to the verdict that closes one
(`cyclesOf`) — each with when it began, how long it took, what its rounds cost, how it ended, and each
stage's rounds and what they sent back, named by the description the orchestrator gave its first
dispatch, the one name the record keeps. The first new project's newest six cost $320, the costliest a
spike step at $79 whose reviewer sent back two rounds of three. A cycle is a shape, not a feature's
boundary: work run side by side in one session can share one.

### A step against its forecast: `nina sizes`

The architect forecasts each step (`Size: ~N lines in M files`) and splits past the limit, and nothing compared a
forecast with what landed. In the third project two steps landed about 1.5× theirs before a reviewer worked the
factor out by hand, and a whole architect run — 28 minutes, 375k tokens — then re-derived the rates from
`git diff --numstat` to forecast six steps again. `nina sizes` reads each step file
(`.claude/plans/specs/<spec>.step-<n>.md`), finds its commits by their message — the spec and `step <n>`, as the
router has a commit named; where the spec is followed by a step, that step alone, since a commit that landed
`<spec> step 6` and said "M6 step 7's clause corrected" was counted a landing of step 7 too, 412 lines against a step
with no code yet; where no step follows it, any step the message names, the form older commits took — and sets the lines they added outside the harness's own files and the lockfiles beside the
forecast the file carried before the first of them: the forecast it was built to. A forecast a fix round changed while
the step was built is shown, not measured against, because measured against it a step always lands on forecast.

The rate it gives a step still to land is the median over the newest landed steps forecast no earlier than that one
was. Two of the third project's three landed steps were forecast before a re-forecast at their own rates; the steps
still to land were forecast after it, and measured by all three they were corrected for the old error twice. When a
forecast was written is the oldest commit of the newest run that carried its number, so an edit to the rest of a step
file does not move it; a forecast changed in the working tree is newer than every commit.

What a step missed its forecast by is its first round where its step file says so (`First round: ~N lines`, which the
orchestrator writes with the commit of a step that took more than one implementer round): the rounds after it are the
review's. In the third project two steps of a new script landed ×1.61 and ×1.49, and the second's first round was ×1.18:
its fix rounds made the rest, and each rate went onto steps that only extend an existing file, forecast at ×1.35 from
their own kind, until those stood at ×3.24 of their count and twenty more splits were asked for. So a step may say its
kind (`Kind: new`, `extends`, `tests`), and is measured by the landed steps of its kind where any landed, by all of them
otherwise. A step revised while it was built is shown against the revision too (`×1.32; ×1.04 against it`), so a
correction round reads apart from a forecasting miss.

As a detector in every project's `harness:check` (`--check`), it speaks when the newest landed step came in more than
a quarter over and steps forecast no later than it still carry those forecasts, and stops once any of them is forecast
again: the next to go out is forecast at its turn, and the rest at theirs, once the steps before them have measured the
rate again. Asked for every one at once, it kept the detector red for steps three or more away.
It runs every turn, so it asks git four times, not once per file: a version per process came to most of its second.
During `nina upgrade --apply` it stands aside, as the lessons detector does, and the move says what it found once it is
done: an overrun is the project's history, not the move's doing, and the release that first shipped the detector read
it as breakage and rolled itself back in the project that had asked for it.

A step file whose `Size:` line reads as no forecast is listed, with what the line says, rather than left out of every
rate without a word: in the third project an orchestrator rewrote one step's line between its fix rounds into "round 1
landed +498/−95 against ~272", and that step went missing from every rate. The detector names only a step still to
land, whose line can be written again now; a landed step's line is history, and a detector that speaks about history
speaks every turn for good. The label opens its line, as `Kind:` does, so `font-size:` in a step's CSS and a sentence
that names the line are not one. Nor is a line it cannot read read more loosely: another project writes `~220 raw lines
… ≤ ~400 at the milestone`, where the forecast it means is the second number, and read as the first every one of its
steps would have overrun.

Beside a step still to land, `nina sizes` shows what it carries over its first forecast — the oldest number its file
held in a commit — and what its kind's landed steps missed by. The third project's steps were restated at three rates
of a new script's steps, one onto another, and stood at ×2.54 of their count where their own kind measured ×1.35: ten
of them would have gone to the architect to be split. It reads this from the file's history, not from the rates a
`Size:` line names, which are prose each project writes its own way; the router says a forecast carrying another kind's
rate is restated from its own count.

### Where the re-read went

Turns times context says what a round cost, not what filled the context. Read from the transcripts of two projects'
subagents — the third project's 132 rounds over a week and the second's 685 over three — the context a round opened
with was 18% and 30% of all they re-read: the system prompt and tools, `CLAUDE.md` (9.7k and 13.7k tokens), the
spec (6.7k and 7.3k), and a listing of every installed skill's description, 9.2k tokens in every stage allowed
`Skill`, as much as `CLAUDE.md`. Shell output longer than a screen was 22% in both, though Hard Rule #19 had asked
for it in a file since it was written. And in the third project a quarter of what the stages spent on input was
the cache written again: a subagent's cache lives five minutes without a turn, a write costs twelve times a read,
and 142 calls had waited five to ten minutes in one, as the rule then said to.

So each round keeps three counts more. `cache_rewrites` is the turns that wrote more than half of a context of
at least 30k tokens again, and `cache_rewritten` what they wrote; `clipped` is the outputs the cost watch moved
to a file, counted where the run received them, never in the hook's echo of one or where the model quoted it.
`stats` sets beside the context table, stage by stage, the share of its re-read that was what its rounds opened
with, its rewrites with their share of what it spent at its model's price, and its clipped outputs; a round
measured before the fields existed is left out of the shares rather than counted as none. That first reading
put the third project's implementer at 95 rewrites and 38% of its spend, and every reviewer's rounds at 43% to
51% opened-with: a short run is mostly the context it began with.

Read again by the same method, over the second project's 477 subagent runs in the six days before those changes
and its 475 in the three after, the context a call re-read was the same, 137k and 138k tokens. The skill listing had
gone from 8.6% of what the stages re-read to 6.1%, and shell output past a screen stayed at 22%: three quarters of it
was a file or a diff the run asked for, by `sed`, `head`, `cat` or `git diff`, which the clip leaves whole on purpose.
What the listing kept was mostly the skills bundled with Claude Code, whose descriptions the budget spares: 8k of its
10k characters, `dataviz`, `code-review` and the artifact skills among them, none of which a stage uses. A cap on
each description reaches them, so `wire` sets that too; in a probe the listing went from 8,266 characters to 2,194 in
the main session and in a subagent alike, with all 78 skills still named. The servers' own instructions were 2.6% more,
an MCP server's reaching every stage whether or not its tools did, but which servers run is the owner's machine
configuration, not a project's, so the harness leaves it to them.

Two measured things were left as they were. A subagent can skip `CLAUDE.md` (`omitClaudeMd`), and the part only
the orchestrator needs is 3k tokens of it — but the rest would have to reach each stage some other way, and a
hook's `additionalContext` is capped at 10,000 characters where that rest is 24,000. And a subagent's cache can
live an hour, but its every write then costs 2× rather than 1.25×: the third project would have saved about 13% of
its input spend, and the second, whose calls rarely wait, lost about 12%.

### While a run is still running: the cost watch

`stats` says what a run cost after it ended, and by then the money is spent. Three quarters of the first
new project's implementer spend was the run's own context read again, every turn re-reading everything the
run had built, so a run's cost grows faster than its work — a median 36M tokens a round there, 159M at
most. `scripts/cost-watch.mjs`, a composed script the project's hooks run after every tool call
(`src/cost.mjs`), keeps count while it happens; the orchestrator's calls, which it does not watch, leave
before the package is loaded. Claude Code runs a PostToolUse hook for each tool a
subagent calls, with the subagent's id, and gives the `additionalContext` it answers to that subagent —
which was probed on 2.1.283 rather than assumed; the documentation does not say. The watch reads only what
the run's transcript gained since its last call, keeps each message's cache read by its id (a streamed
message is written once per block), and when the run's total passes `RUN_READ_WARN` million tokens (40 by
default, a vocabulary name a project can change) and again at every doubling, it tells the run what it has
re-read and what one more turn now costs, and to hand back what is left if that is more than one run
should carry; and it tells the person in one line. 40M passes one implementer round in ten in the project
whose steps were sized right, and half in the one whose were not. It keeps counts only, under the project's
gate directory, and a call outside a subagent returns at once.

Two things a turn pays for on every turn after are settled at the call itself. A Bash output longer than
`OUTPUT_CLIP` characters (8000 by default; 0 turns it off) is written whole to a file in the session's
`tool-results` directory, beside the ones Claude Code moves out itself past 30,000, which stages were already
reading there; in its place the run gets the hook's `updatedToolOutput` — the first lines, the last, where a test
runner or a battery prints its summary, and where the rest is. A command that reads a file or a diff (`cat`, `sed`,
`head`, `tail`, `git diff`, `git show`) is left alone: what it prints is what the run asked for, and clipping it would
only send the run to read the file it was cut to. That a subagent sees the replaced output was probed on 2.1.303,
not assumed. Only successful calls reach a PostToolUse hook, so a failure is never clipped. The file is the command's
output, kept where Claude Code keeps its own and for as long as the session's are, never in the measurement store,
which counts the clipped outputs and holds none. And a call whose
`duration_ms` passed the five minutes a subagent's cache lives is named to the run — its next turn writes all of
its context again, with the size the transcript last gave — and to the person in a line, so the wait that cost it is
seen while there is still a run to change.

### Which model a stage ran on

A spec's `model:` is the one choice in the harness that moves cost by an order of magnitude, and until
it was measured it was only ever read. Every record already says what ran (`usage_model`), so `stats`
reads a stage that ran on more than one model model by model: its runs, the dates, how often it sent
work back and what a run cost. The first reading, over one project where the reviewer's spec moved from
`sonnet` to `opus` on 2026-09-04:

```
  models — a stage that ran on more than one model or effort level, one line each; different weeks, not an experiment
    reviewer            claude-sonnet-5        49 run(s)  2026-08-12 → 2026-09-04  loop-back 4% of 49  median $0.69
                        claude-opus-4-8        72 run(s)  2026-09-05 → 2026-09-10  loop-back 19% of 52  median $0.75
                        claude-opus-5          55 run(s)  2026-09-16 → 2026-09-22  loop-back 39% of 51  median $3.18
```

The header says what it is not. Three windows of different work are not an experiment: a reviewer that
sends back more may be catching more or may be noisier, and nothing in the rate can say which. What the
table settles is whether a change is worth `nina eval`, which does hold the work still.

The same block asks whether each stage runs on the model its spec declares, where the project's
directory can be found. An alias names a family, as a whole segment of the id wherever it sits (`sonnet`
is `claude-sonnet-5` and `claude-3-sonnet` alike), a full id names one model, and `inherit` declares
nothing to compare with. Only runs made after the `model:` line last changed count, because a spec
changed today says nothing about yesterday's runs. That date comes from the project's history, the last
commit that touched the line: the file's own time was the first version, and a review found what moves
it without the model moving, since `compose` rewrites every composed file and an upgrade changes specs
whose model it leaves alone. The file's time stands in only where history cannot say: no repository, a
file it does not track, or a model changed and not yet committed. A difference is an override no spec
shows: a model named on the dispatch, or one set for every subagent in the environment. Over the project
it was built on, it reports none, which is what that project's history says.

The per-stage model stays in the spec's frontmatter rather than in `graph.md`, so it is one fact in one
place. `modelFindings` (in `src/tools.mjs`, beside the check of what a spec's tools grant) requires it to
be an alias Claude Code knows (`opus`, `sonnet`, `haiku`, `fable`), `inherit`, or a model id, and an
`effort:` to be `low`, `medium`, `high`, `xhigh` or `max`; the compose suite runs it over every fixture and
`nina check` over every project.

### At what effort

The model alone did not explain what a stage wrote. The architect wrote a median 12k tokens a run on
`claude-opus-4-8` and 90k on `claude-opus-5`, which read as the model's doing. The transcripts also say at
what effort each message ran, and no spec named one, so every stage had run at the session's level, which
the owner's settings set per model: `high` for Opus 4.8, `xhigh` for Sonnet 5, Opus 5 and Opus 5.5. Sonnet 5
at `xhigh` wrote 13k as architect. Opus 5.5 at `xhigh` wrote 277k in the first new project's one run, about
three quarters of it thinking: of the 143k it wrote before its first report, some 36k was the spec and the
calls that gathered it. The reviewer went the same way, 4.5k a run on Opus 4.8 at `high`, 33k on Opus 5 and
65k on Opus 5.5 at `xhigh`. And `opus` itself had moved twice under the harness, to Opus 5 and then to
Opus 5.5, with no release in between.

So each spec names a model id and an effort level, from defaults in `core/vocabulary.json`:
`DEEP_MODEL` (`claude-opus-5-5`) and `DEEP_EFFORT` (`high`) for the stages that judge (the reviewer, the
design-reviewer, secops, devops), and `WORK_MODEL` (`claude-sonnet-5-5`) and `WORK_EFFORT` (`xhigh`) for the
stages that carry a spec out. `high` for the first is one level below where they ran and one above Opus 5.5's
own default, `medium`. `xhigh` for the second is where they always ran, and none of them wrote more than it
had. The architect has a pair of its own, `ARCHITECT_MODEL` (`claude-opus-5-5`) at `ARCHITECT_EFFORT`
(`xhigh`): the owner had seen it specify worse at a lower level, and a spec is what every later stage builds
on, so what it writes is cut in the spec's text instead. The two stages that write and audit immutable code
have theirs, `IMMUTABLE_MODEL` and `IMMUTABLE_EFFORT`, at the judges' values, because a miss there cannot be
fixed after it ships. Until 0.81.0 both read the judges' names; they got their own so a [tier](#at-what-tier)
could move the judges without them. A project that declares `DEEP_MODEL` for a provider of its own declares
these too, and `upgrade` names each one a move leaves on the release's default (`TOOK_OVER` in
`src/vocabulary.mjs`). A model moves when a release moves it, and a project declares any of
these to change it: a provider with its own model ids, or a level it has measured and prefers. The record
keeps the effort beside the model, `stats` reads one model at two levels as two lines, and Langfuse gets it
as metadata. A record from before the field is read once more while its transcript is on disk.

What this cannot say yet is whether the reviewer at `high` still catches what it caught at `xhigh`. That is
a question for `nina eval`, run on the release that names the level against the one before it.

### At what tier

A project picks how much its pipeline spends in one word: `nina init --tier <level>`, or later
`nina compose --tier <level>`, recorded in the profile as `tier`, right after the `core` whose tiers it names.
A tier is a named set of the defaults above, in `core/tiers.json`, frozen with each release:

| | `high`, the release's own | `medium` | `low` |
|---|---|---|---|
| architect | Opus 5.5 · `xhigh` | Opus 5.5 · `xhigh` | Opus 5.5 · `xhigh` |
| the stages that judge | Opus 5.5 · `high` | Sonnet 5.5 · `xhigh` | Sonnet 5.5 · `high` |
| the stages that carry a spec out | Sonnet 5.5 · `xhigh` | Sonnet 5.5 · `high` | Sonnet 5.5 · `medium` |
| immutable code | Opus 5.5 · `high` | Opus 5.5 · `high` | Opus 5.5 · `high` |

A cheaper tier is a smaller family or a lower level, never an older model: Opus 5 and Opus 4.8 cost more per
token than Opus 5.5 (`src/prices.mjs`), and Sonnet 5 costs what Sonnet 5.5 does. The level was the larger cut
anyway — [above](#at-what-effort), it moved what a stage wrote more than the model did. The architect and
immutable code are in no tier, for the reasons they have names of their own.

A tier takes only `_MODEL` and `_EFFORT` names: one that moved a command or a limit would change what a stage
does, not what it runs on. A model the project declares wins over its tier, as it wins over the release's
default. Every reader of a default a tier can move — `compose`, `check`, `init`, `upgrade`, `status` — asks
`defaultVocabulary(root, tier)` in `src/vocabulary.mjs`, so the tier is read one way. It lives in the profile
rather than on a flag because a flag only the composing command saw would be undone by the next `compose`
without it, and every hook that recomposes runs without it. A tier the pinned release lacks is refused by
`init`, `compose` and `upgrade` before they write anything, and reported by `check` and `status`: composing
the release's own models instead, without a word, would run every stage on what the project said it did not
want. `status` shows the tier and what each kind of stage runs on, and `compose --tier` asks for a new Claude
Code session, which registers each agent's frontmatter when it starts.

A cheaper tier saves less than its price per token says if it lets through what the dearer one catches: the
work comes back a round later. `stats` and `runs` already split a stage by model and effort, and
`nina eval --release <v> --tier low --tier high` sets one tier's reviewer against another's on the same
planted defects before a project trusts it. `--model` is refused beside `--tier`: it runs every reviewer on
one model, and the two tiers would differ in effort alone.

The first reading that ran each review at its spec's effort came on 2026-10-29, with `--judge` and four runs a
design, the old `medium` from 0.82.0 and the new one from the layers that became 0.83.0. The two readings before
it, on 0.81.0 and 0.82.0, ran every review at `medium` ([below](#evaluating-a-release)) and compared the models
alone:

| the stages that judge | caught, graded by line | by the judge | noise | a review | report |
|---|---|---|---|---|---|
| Sonnet 5.5 · `high`, `low` | 11, 5, 6, 9: 7.8 | 12.0 | 7.0 | $0.10 | 5.4k |
| Sonnet 5.5 · `xhigh`, `medium` | 11, 11, 11, 9: 10.5 | 11.3 | 7.3 | $0.22 | 7.4k |
| Opus 5.5 · `medium`, `medium` until 0.83.0 | 11, 10, 11, 11: 10.8 | 11.8 | 7.0 | $0.32 | 6.6k |
| Opus 5.5 · `high`, `high` | 11, 11, 11, 11: 11.0 | 12.0 | 8.0 | $0.41 | 7.5k |

The cost is API-equivalent; the eval runs on the login. Every design describes nearly all twelve defects; where
they part is the line. Sonnet at `high` named every one, and in two of its four runs cited only half of them or fewer
where they are, a file named without a line in each. At `xhigh` it cited almost as Opus does, at about half Opus's
price. Opus at `medium` read almost as Opus at `high` for three quarters of the price, which put the old
`medium` next to `high` rather than between it and `low`. So since 0.83.0 `medium` runs the judges on Sonnet at
`xhigh`, between the two in cost. The judge credits it least, 11.3, because three of its claims about those
reports came with a quote the report did not hold, and a claim without its quote is not believed. Four runs a
design on one change is little: the spread within `low` alone was six defects. Nothing here measures the
stages that carry a spec out, which `low` and `medium` move to `medium` and `high`, and no eval runs.

### Sending it to Langfuse: `nina langfuse`

`stats` and `learn` read the store on a terminal. Langfuse reads the same runs in a UI that filters,
groups and charts them, beside whatever else a project already sends it.

```bash
nina langfuse login                  # asks for a project's keys, checks them against Langfuse, keeps them
nina langfuse on [--content | --prompts]   # in a project: send its runs after every turn, with each stage's context,
                                           # or only the prompt it was given and the report it handed back
nina langfuse status                 # the keys, the projects that send, how the last send went
nina export --langfuse [--dry-run]   # by hand: the history from before a project was turned on
```

Once a project is on, nobody exports anything. The `lessons` detector every composed project runs already
snapshots the project on each turn; after the snapshot it starts the export in the background when a run
is ready to go, and it never waits on the network itself, since the detector runs before the person sees
the answer. A failed export is reported by the same detector, once: the same failure again is not news.
The first version was a command somebody had to remember to run, which is the failure this harness
exists to remove.

The keys are asked for, never passed as a flag (a flag lands in shell history), checked against Langfuse
before they are kept, and kept in `~/.nina/exports/langfuse.json`, readable by the owner only;
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST` override them. Which projects send is kept
there too, not in the project's profile: sending a project's history to a service is the decision of
whoever runs it on this machine, and a committed profile would make it for every clone. A project sends
the runs it makes from the moment it is turned on; its history goes only when `nina export` is asked.

Each dispatch becomes a trace named for its role, the session id setting a pipeline's stages side by side
in Langfuse's sessions view, and its verdict a categorical score beside it. Every root carries the round's
shape as metadata: turns, tool calls, the context at its start and peak, the prompt's length. Without
`--content` or `--prompts` the trace is one observation: a generation with the run's model, usage and the
cost `stats` would estimate, or a span when it spent no tokens. The description the orchestrator gave the dispatch stays behind, and so does
the flattened path that names the owner's home directory: the project goes by its directory's name.

With `--content`, the trace is the stage's own run, read from its transcript at the moment of sending and
never kept, so the store stays metadata only: the agent at the root, its prompt in and its report out; a
generation per message it wrote, with that message's tokens and cost; and a tool observation per call,
with what went in and what came back. The usage sits on the messages and not on the root, so no sum
counts a token twice. Every text is cut (20,000 characters for a prompt, a report or a message, 8,000 for
a tool's input or result), the owner's home directory is written `~`, and obvious secrets are masked:
private keys, the token formats of the common providers (payment and webhook keys and JWTs among them),
the password in a URL, an `Authorization` value under any scheme, a cookie header, a value passed after a
command-line option that names a secret (`--password …`, `-u user:…`), and anything assigned to a name that
says it is a secret, quoted values with spaces included. An assignment to any other name is read into, not over: a tool's input
goes out serialized, and `{"content": "API_KEY=…"}` once took the `.env` a `Write` carried out whole, as
one value of `content`. The scan is linear in what it reads, and a test holds it there. That is a floor,
not a promise. A secret that looks like none of them
goes as it is, and so does every line of code a stage read, which is why context is a switch per project.

It is also far more data. Over one project's 826 runs, context meant 70,863 observations and 166 MB,
against 826 observations without it. Langfuse bills every trace, observation and score as a unit, and its
free plan includes 50,000 a month.

With `--prompts`, only what passed between the agents goes: the prompt each round was given — the
dispatch, or the message that resumed the run — and the report it handed back, on one observation per
round. Nothing is beneath it, so it is a generation again, with the usage and cost beside the texts. It is for improving what the orchestrator hands a stage, which is read against how the
round went; what the stage read and called in between is what `--content` adds, and is most of the data.
The same masking applies, and a prompt still carries whatever the orchestrator put in it, diffs and code
included. What a round was told is read by one rule, `promptOf` in `src/transcripts.mjs`, which the
snapshot also uses to keep each round's `prompt_chars`, so `stats` shows the length of what a stage was
handed without anything being sent anywhere.

Observations go over OpenTelemetry (`/api/public/otel/v1/traces`, OTLP/HTTP as JSON), which is how
Langfuse's v4 data model takes them. Scores go in batches, as `score-create` events to
`/api/public/ingestion`: the scores endpoint takes one per request and sits in the general API bucket, 30
requests a minute on the free plan, so a first export's few hundred verdicts would be refused after
thirty. The batched endpoint is deprecated for everything else and keeps taking score events past November
2026; where it is gone, scores go one by one, the run stops at the first refusal, and the next turn sends
the rest. Requests are packed by size as well as count, at most 1 MB where Langfuse takes 5, and a stage is
never split across two, so a failure never leaves half a stage behind for a retry to send again. One too
large alone has its texts cut harder; one that still does not fit, because it made thousands of calls, goes
as its record alone and the export says so. Refused instead, it would fail on every turn and hold back
every run after it. A request gives up after 30 seconds, and a batch of spans after 120, because a host that
stops answering would otherwise hold the project's lock, and every later export would find it taken. No
dependency: `fetch` is enough.

The design was settled by one fact found before anything was sent: Langfuse keeps what it is first sent.
The first version resent a record whenever the snapshot changed it, on the reading that an id derived
from the dispatch would make the second send an update. It would have made it a second observation, and
every sum over the project would have counted both. A score is replaced only when its id, name and date
all match, and no endpoint lets the date be chosen. So each run is sent once: its trace when it has
**settled**, 15 minutes after it returned (or 24 hours after it was dispatched, for one that never did),
because the snapshot fills a record in after the fact (a verdict read from a resumed run, tokens from a
transcript that grew); and its score once it has a verdict and its trace is there. A verdict read after
the trace went still gets its score, since that is a first score and not a second span. A record that
changes after it went is counted and said, not sent again.

What was sent is kept per project under `~/.nina/exports/langfuse/`, written after every request that
succeeds, so a failure or an interruption leaves a retry only what did not go. The one way a span can
still go twice is a request Langfuse took whose answer never arrived, a timeout included, which is why a
request is kept small and a batch of spans is given two minutes. Everything else that could send twice is
refused instead:

- A batch Langfuse did not take is sent again later, and its runs' scores wait with it, so no score
  points at an observation Langfuse does not have.
- A batch it took while refusing part of it (OTLP's `partialSuccess`, which counts the spans refused and
  does not name them) is recorded as sent, since sending it again would double the ones it kept, and its
  runs get no score, since any of them may be one it refused.
- A batch of scores that comes back with no word on an event counts that event as taken, since a score
  sent again on another day is a second score; only one Langfuse names as refused is sent again.
- Two exports of one project do not run at once: each would read what was sent before the other wrote.
  A lock names its process, so one left by a run that died is taken over.
- A record of what was sent that cannot be read stops that project's export. Read as empty, it would
  send the whole history again.

A record with no time cannot be placed on a trace and is never sent, and the export says how many there
are.

### Evaluating a release

Every rule so far was argued for, shipped, and then read back from a loop-back rate — a number that moves
with the work as much as with the rule, and that went up after the first two lessons it was asked to
verify. `nina eval` asks the question as an experiment instead: the same change, carrying the same planted
defects (`evals/reviewer/`), is reviewed by the reviewer each release composes, and the report counts what
each one caught.

```bash
nina eval --release 0.23.0 --release 0.24.0 --repeat 2    # two releases, two runs each
nina eval --release 0.81.0 --tier low --tier high          # one release at two tiers: each tier is an arm
nina eval --release 0.24.0 --dry-run                       # stage, compose and grade a canned report; no model
nina eval --regrade <reports dir> --judge                  # read kept reports again, with the judge; no review run
```

It runs `claude -p` as the composed reviewer (`--agent reviewer`), at the effort its spec names, in a throwaway
copy of the fixture, on the login Claude Code already has — a subscription, never a per-token bill: every credential that would bill
per token (or route it through a gateway) is removed from the child's environment unless `--api` asks
otherwise. The child only reads — a tool allowlist under `--permission-mode dontAsk`, so the reviewer runs
with the typecheck, lint and `harness:check` its spec mandates denied, the same for every release — loads
no user settings, so no global hook snapshots the eval into the owner's statistics, and writes no session.
It is not hermetic across machines: user-level agents and skills still load. A run that did not review
(not logged in, out of turns, `claude` missing) is reported as a failure rather than graded as a review
that caught nothing.

The effort goes on the command line, as `--effort`, because the CLI does not read it from the spec of its main
agent. It reads that spec's `model:` and leaves its `effort:` aside, and the transcript of every message says
so: a reviewer composed at `xhigh` ran at `medium`, the CLI's own default. A subagent dispatched in a session
does run at its spec's level: in two projects' runs the reviewer ran at `high` under a session set to `xhigh`.
Until 0.83.0 the eval passed only the model. So every review before it ran at `medium` whatever its release
said, and no comparison before it measured effort. Tiers that moved only the effort read alike for that
reason, not because effort moves nothing. A release whose spec names no effort is still run without the flag,
at the default.

Grading is deterministic and approximate in both directions, which is why every report is kept beside
it. A cited line goes to the nearest anchor of a defect in its file, within two lines; a citation equally
near two defects credits neither, because the planted lines sit one apart and the defect listed first used
to win. A file-level defect (a file that should not have changed, or should have been deleted) is credited
only in an issue the report raises — a list item below its `ISSUES` line — because the reviewer's
"artifacts checked" section names every file the spec lists, often with a ✅, and a ✅ line is never a
catch. A defect described without a line of its own is missed.

The first real run, on 0.24.0: 11 of 12 caught, the one missed described inside a line range — eleven of
the twelve map to a rule the composed reviewer carries, and that one is plain correctness; and the
verdict line was not the report's first line — the reviewer, run as the main agent and denied the
typecheck, explained that first. The gate and the snapshot would have read no verdict at all, which is the
kind of thing only running the stage for real could show.

`--judge` reads each report the way the grading cannot. A second model, on the same login and with no
tools, is given the planted defects, the report and the change, and must answer to a JSON schema: for every
planted defect, found or not, and for each found one a verbatim quote from the report — a claim whose quote
the report does not hold is not believed, and is counted apart; then each finding outside the planted set,
real or noise. The defects are listed before the review, which invites a judge to agree, so every judging
invocation first judges a report that found nothing, once: it must come out 0, or the numbers after it are
printed as suspect. An answer that leaves a defect uncalled, or calls one with anything but a boolean, is a
failed judge — never read as a zero it did not give. The review and the change go in as quoted material,
unable to close their tags. It is a call per report, so it is off by default, and skipped under `--dry-run`;
`--regrade` runs it over kept reports without reviewing again. On the first real report, before the quote
and the control existed, it identified all twelve — the swallowed error the grading missed was described in
words.
