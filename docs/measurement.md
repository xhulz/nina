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
distinct files the run wrote, and the tokens the run spent by kind with the model that spent them. No report text, no source, no PII, not
even a pill's path or an issue's id — and no dollars: a price is a fact about a date, so `stats`
prices the tokens when it reads them, at the list prices in `src/prices.mjs`, and says which date's.
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
unless a loop-back sent the work there; a closing stage whose verdict cannot be read closes it too, and
is counted. It is sized by the most files any one writer wrote in it — through the edit tools, so a
shell-written file is missed and the size is a floor — and the report is a distribution rather than a
list of violations: a critical path is gated in full at any size and cannot be seen in a file count,
and one spec legitimately covers sibling steps. Two boundaries were wrong before this one. The owner's
prompts gave 22 "undesigned" large changes of which 18 came right after a spec — every "pode seguir"
cut a pipeline in two. Closing stages alone left the light chain, which has no qa, to be absorbed by
the design that followed, and let a qa with no readable verdict hold a dozen pipelines in one cycle:
that reading said all four small changes had been designed. The reading that survived, over 132 cycles:
5 of 8 one- and two-file changes ran a planner or architect, 62% of the three-to-nine-file ones did, and
84% of those of ten files or more — with 29 cycles closed by a qa whose verdict could not be read.

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

### Sending it to Langfuse: `nina export`

`stats` and `learn` read the store on a terminal. Langfuse reads the same records in a UI that filters,
groups and charts them, beside whatever else a project already sends it.

```bash
nina export --langfuse --dry-run                 # what would go, and one span as it would be sent
nina export --langfuse [--project Spliter]       # LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST
```

Each Claude Code session becomes a trace, named by the project's directory, and each dispatch an
observation on it: a generation when the run spent tokens, with its model, usage and the cost `stats`
would estimate, and a span otherwise. The verdict goes beside it as a categorical score. What goes is the
store's metadata and less: each span is built field by field, so the description the orchestrator gave a
dispatch stays behind, and so does the flattened path that names the owner's home directory. The
credentials come from the environment, never a flag, since a flag lands in shell history.

Observations go over OpenTelemetry (`/api/public/otel/v1/traces`, OTLP/HTTP as JSON), which is how
Langfuse's v4 data model takes them; its `/ingestion` endpoint stops accepting them in November 2026. No
dependency: `fetch` is enough.

The design was settled by one fact found before anything was sent: Langfuse keeps what it is first sent.
The first version resent a record whenever the snapshot changed it, on the reading that an id derived
from the dispatch would make the second send an update. It would have made it a second observation, and
every sum over the project would have counted both. A score is replaced only when its id, name and date
all match, and the scores endpoint takes no date, it stamps the day it is called. So each run is sent
once: its span when it has **settled**, 24 hours after its last known moment, because the snapshot fills
a record in after the fact (a verdict read from a resumed run, tokens from a transcript that grew); and
its score once it has a verdict and its span is there. A verdict read after the span went still gets its
score, since that is a first score and not a second span. A record that changes after it went is counted
and said, not sent again.

What was sent is kept per project under `~/.nina/exports/langfuse/`, written after every request that
succeeds, so a failure or an interruption leaves a retry only what did not go. The one way a span can
still go twice is a request Langfuse took whose answer never arrived. Everything else that could send
twice is refused instead:

- A batch Langfuse did not take is sent again later, and its runs' scores wait with it, so no score
  points at an observation Langfuse does not have.
- A batch it took while refusing part of it (OTLP's `partialSuccess`, which counts the spans refused and
  does not name them) is recorded as sent, since sending it again would double the ones it kept, and its
  runs get no score, since any of them may be one it refused.
- Two exports of one project do not run at once: each would read what was sent before the other wrote.
  A lock names its process, so one left by a run that died is taken over.
- A record of what was sent that cannot be read stops that project's export. Read as empty, it would
  send the whole history again.

One refused score does not hold back the rest, or a single bad one would block every later run's; a
whole group refused means the endpoint is down, and the run stops. A record with no time cannot be
placed on a trace and is never sent, and the export says how many there are.

### Evaluating a release

Every rule so far was argued for, shipped, and then read back from a loop-back rate — a number that moves
with the work as much as with the rule, and that went up after the first two lessons it was asked to
verify. `nina eval` asks the question as an experiment instead: the same change, carrying the same planted
defects (`evals/reviewer/`), is reviewed by the reviewer each release composes, and the report counts what
each one caught.

```bash
nina eval --release 0.23.0 --release 0.24.0 --repeat 2    # two releases, two runs each
nina eval --release 0.24.0 --dry-run                       # stage, compose and grade a canned report; no model
nina eval --regrade <reports dir> --judge                  # read kept reports again, with the judge; no review run
```

It runs `claude -p` as the composed reviewer (`--agent reviewer`) in a throwaway copy of the fixture, on the
login Claude Code already has — a subscription, never a per-token bill: every credential that would bill
per token (or route it through a gateway) is removed from the child's environment unless `--api` asks
otherwise. The child only reads — a tool allowlist under `--permission-mode dontAsk`, so the reviewer runs
with the typecheck, lint and `harness:check` its spec mandates denied, the same for every release — loads
no user settings, so no global hook snapshots the eval into the owner's statistics, and writes no session.
It is not hermetic across machines: user-level agents and skills still load. A run that did not review
(not logged in, out of turns, `claude` missing) is reported as a failure rather than graded as a review
that caught nothing.

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
