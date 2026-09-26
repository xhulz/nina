# The pipeline graph, and the loop gate

The graph every project composes, and the gate that holds its loop caps. Read before touching `src/graph.mjs`, `src/gate.mjs`, `src/commands/gate.mjs` or `core/tree/.claude/graph.md`.

**The pipeline is a graph, declared once.** `core/tree/.claude/graph.md` states the stages and every
edge between them — `from → to on TOKEN — when · max N` — and the surfaces that add a stage add its
node and edges through slots, so a project's composed graph contains exactly the stages it has.
It used to exist only as prose, restated across thirteen documents, and prose cannot be checked; now
`nina check` and the compose suite both run `src/graph.mjs` against it, and every other document
describes the graph rather than being a second copy of it. A spec's own "back to **architect**" is
checked against the edges, so the prose can still say it but cannot contradict it.

The stages that may run as several agents at once are declared the same way, under "## Concurrency":
`` `implementer` × many — when ``, for the architect across a milestone's sibling specs, implementers on work
that shares no file, and reviewers fanned out by risk. They were prose too, and `nina pipeline` could not
mark them on the line it draws. `nina check` refuses one that names no stage.

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
