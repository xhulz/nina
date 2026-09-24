# Pills of Knowledge

Hard-won, per-agent **behavioral corrections** — lessons learned the expensive way (a loop-back,
a rejected diff, a blocked milestone, a user correction). Each agent reads its own pills **before
acting** so it does not repeat a past mistake.

This is a knowledge surface, not a convention doc. Keep the niche clean:

| Surface | Holds | Example |
|---|---|---|
| `CLAUDE.md` / `.claude/patterns.md` | **Codebase law / conventions** | "relative imports carry a `.js` extension" |
| `.claude/integrations/<slug>.md` | **External premises**, with evidence | "the client's `signOut()` never rejects" |
| **`.claude/pills/<role>/` (here)** | **Agent behavioral corrections** | "implementer: `waitFor()` hangs under fake timers" |

If a lesson is really a code convention or an external premise, it belongs in those files — not here.

## Layout

```
.claude/pills/
├── README.md     # this file
├── shared/       # pills that apply to MORE THAN ONE role
└── <role>/       # one directory per role, named exactly as its spec in .claude/agents/
```

A role directory is created on demand, when its first pill is written. One **lesson per file**,
`kebab-case.md`. An agent reads `pills/<its-role>/*.md` **and** the `pills/shared/*.md` whose
`applies_to` includes it.

Placement is not decoration — it is delivery. A pill sitting in `architect/` that declares
`applies_to: [architect, implementer]` is never read by the implementer, because the implementer
only globs its own directory and `shared/`. So the rule is mechanical, and `nina pills` enforces it:

- **one role in `applies_to`** → the pill lives in that role's directory
- **more than one** → the pill lives in `shared/`

A pill loose at the top level of `pills/` is read by nobody.

## Pill format

Frontmatter is mandatory. A pill without it still reads like prose to a human, but it is invisible
to every filter the agents and the tooling run — `status`, `trigger` and `applies_to` all stop
working, so the pill is either ignored or applied where it does not belong.

```markdown
---
id: <role-dir>-<file-slug>         # derived from the path, so it cannot drift
applies_to: [implementer]          # one or more roles; drives who reads it, and where it lives
severity: low | medium | high
status: active | retired           # retired = graduated into a rule, kept for history
date: YYYY-MM-DD                   # when learned; this is what lets staleness be spotted
occurrences: 1                     # bump when the SAME lesson is learned again — see Graduation
last_seen: YYYY-MM-DD              # set with every bump; how the harness knows the lesson is current
trigger: <when this pill is relevant — the agent applies it only if the task matches>
citations: [path/to/file.ts:42]    # the code this pill is a claim about, when there is any
---
**What went wrong:** <the concrete mistake, with where it happened>
**Rule:** <the imperative — what to do / not do next time>
**Why:** <the mechanism, so the rule is understood and not merely obeyed>
**How to apply:** <the concrete check or step the agent runs>
source: <the run / commit / conversation that produced the lesson>
```

The `id` is the pill's directory and filename joined. When the filename already opens with the
role — `reviewer/reviewer-never-write-to-repo-files.md` — the role is not repeated.

**Every pill carries evidence: `citations`, or `source`, or both.** A pill is a claim about how
this system behaves, and a claim with nothing behind it is the thing this harness exists to remove.
The two are not interchangeable, and that is why they sit in different places:

- `citations` point at code in this repository, so a machine can later ask whether the cited line
  still exists. Use them whenever the lesson is about code. They are a **frontmatter field**
  because tooling reads them back.
- `source` points at the episode — a run, a commit, a conversation. Use it when the lesson is about
  a tool or a process and there is no line to cite. Only a person ever reads it, so it closes the
  body rather than crowding the header.

## The four guardrails (so this stays an asset, not noise)

1. **Bounded growth + graduation.** "Read all my pills" only works while the set is small. See
   *Graduation* below.
2. **Staleness.** A pill that cites code rots like any note. `date` flags age and `citations` make
   the rot findable; **verify before trusting**, and prune or update when you next touch the topic.
3. **Defined authoring trigger.** A pill is written on **every loop-back** (qa → implementer, a
   reviewer rejection, a mandatory gate blocking) **or user correction**. The orchestrator writes it
   as a named pipeline step — not "when someone remembers". If the lesson already has a pill, do not
   write a second one: increment that pill's `occurrences` instead.
4. **Trigger-targeted, not blanket.** The agent reads its pills but **applies only those whose
   `trigger` matches the current task**. This is what lets the corpus grow without drowning the agent.

## Graduation

`occurrences` is the counter that decides when a correction has stopped being an anecdote. A pill
learned once is a note. The same pill learned a third time is evidence that the surrounding rules do
not cover the case, and the fix belongs where nobody has to remember it:

- a convention the codebase should state → `.claude/patterns.md` or `CLAUDE.md`
- a premise about a dependency → `.claude/integrations/<slug>.md`
- a correction that would apply to **any** project of this shape → back into the harness itself, as
  a rule in the core or in the surface that implies it

Once the rule is written where it belongs, set the pill `status: retired` and leave it in place. A
retired pill is history, not instruction: agents skip it. Deleting it would lose the reason the rule
exists.

A lesson that belongs in the harness cannot be written there from this project — the core and the
surfaces live in another repository, and this project composes a frozen version of them. So
graduating it is a request, and nobody has to remember to make it: when a pill reaches three
occurrences, `harness:check` writes one under `.nina/requests/`, carrying the pinned version, the
layer the rule belongs in and the lesson in this project's words. **Commit it with the pill.** The
harness maintainer answers it in a release — with the rule, or with the reason it stays here — and
the `nina upgrade` that installs that release closes the request: a rule retires the pill, a decline
leaves it active as this project's own lesson. Until then the pill stays active; retiring it earlier
drops the lesson in the gap. (`nina learn --graduate <pill>` sends one sooner, by hand.)

`nina pills` names every active pill that has reached three occurrences and proposes where it
should go: the core when its roles are composed by every project, or the surface that its roles
exist for. That is a proposal, not a verdict — a reviewer lesson can still be about one surface, and
only a person can tell. It is reported as a note, never a failure: a recurring lesson is work to
do, not a defect.

## Reading contract (referenced from each agent spec)

> Before acting, read `.claude/pills/<your-role>/*.md` and the `pills/shared/*.md` whose
> `applies_to` includes your role. Treat `status: active` pills as binding for any task matching
> their `trigger`. Skip `retired` pills. If a pill cites code that no longer exists, prefer the
> current code and flag the pill as stale.

## Checking

```bash
nina pills --project .
```

Reports malformed frontmatter, pills filed where their audience will not read them, roles this
project does not compose, and pills carrying no evidence.

It also resolves every `citations` entry against the repository. A path that no longer exists, or a
line past the end of the file it names, is a failure: the pill is telling an agent to look at
something that is not there. A citation that still resolves in a file which **changed after the
pill's `date`** is only a note — the line survived, but the code on it may have moved on, and no
machine can settle that. Verify it before trusting it, then update the pill or retire it.

This is what `citations` buys, and it is the reason the format asks for them. A pill with only a
`source` cannot be checked this way at all.
