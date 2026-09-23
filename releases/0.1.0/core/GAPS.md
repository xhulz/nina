# Known gaps in the extraction

The nine agent specs were sliced out of a single live project, and a slice cannot be
cleaner than the thing it was cut from. Every line had to land in exactly one layer, and
some lines carry two levels at once — an invariant rule stated through this project's
nouns. This file names those, so they stay debt that is visible rather than debt that is
forgotten.

**None of them are fixable today.** The proof that nothing was lost is that the composed
output is byte-identical to the file that is running. Rewriting a line to make it generic
breaks that proof before there is a second project to check the rewrite against. The fix
belongs to the bootstrap of project #2: at that point the detector (`nina compose --check`)
takes over as the standing test, and the byte-exact test has done its job.

## Domain examples that stayed in the core

The rule is invariant, the example is not. Kept in the core because losing the rule costs
more than a dangling noun, and because every project on this stack declares these surfaces
anyway.

| Spec | What |
|---|---|
| planner | the `L`/`XL` triggers *Mixed concerns* and *Multiple security invariants* name the money pipeline and the Durable Object; the `ONE-SPEC` floor names money / Prisma / auth / the provider |
| architect | Output #5 (*Data flow*) names the webhook→match→split→payout stages; #8 (*Tests to add*) names the split invariants; #15 names Cloudflare Pages |
| implementer | *Outputs* and *Handoff* name Prisma and the provider package as the things to flag |
| reviewer | the skill-citation paragraph names Workers/DO/wrangler; the patterns line names Route→Service→Data and `BigInt` centavos; the preview line names Cloudflare Pages |
| integration-tester | the *real services* mode and its end-to-end example name Better Auth, Accelerate and Miniflare |
| devops | the skill-citation line names wrangler; *When you run* names wrangler config and queue/DO bindings |
| implementer, devops | `tools:` grants the `browser_*` MCP tools unconditionally — harmless where there is no frontend, but it is a grant nobody asked for |

## Invariant rules that landed in the project layer

The opposite error. These are generically valuable but were stated through an incident or
an inventory that belongs to one project, and a false historical claim is worse in a new
project than a missing rule — it is an instruction the agent will dutifully chase.

| Spec | What was lost to the project layer |
|---|---|
| secops | threat-model dimension #1 (AuthN / session) — it ends in "this platform already had one near-miss here", so the whole dimension went with it. A new project gets **no auth dimension at all** until this is generalized. |
| qa | the *"pre-existing failure"* paragraph — the causes it lists (`getByText` matching several elements, missing router context, `vi.mock` TDZ, jsdom without `showModal`, a hardcoded origin) are generic frontend test-harness traps; only the provenance is not |
| architect, implementer | the Route → Service → Data layering rule, stated through this project's packages |
| architect | the handoff sentence naming which gates run next |
| patterns.md | the *"when correcting a doc, delete what you are correcting"* lesson — one of the sharpest rules in the harness, told entirely through two spec files and a commit hash, so the whole blockquote went to the project |
| patterns.md | the *Covered today* / quarantine-list paragraphs of § *Test files MUST be inside the typecheck program* — the generic principle and the `tsconfig.typecheck.json` recipe stayed in the core, the inventory did not |

## Fragments that carry a second surface

A fragment lives in one surface but contains a rule from another. A project declaring the
first and not the second gets a rule it has no use for.

- `surfaces/db/tree/.claude/agents/reviewer.md` — the *tenant-and-privacy* review
  dimension carries the no-PII-in-logs rule. A project with a database and no `pii`
  surface gets it anyway.
- `surfaces/external-api/tree/.claude/agents/implementer.md` — the provider section
  carries the "money crosses the boundary as `BigInt` centavos" rule.
- `surfaces/db/tree/.claude/agents/reviewer.md` — the *tenant-and-privacy* dimension,
  as above.

## A composed project is not a finished project

A project with no project layer composes files with holes where its own identity belongs:
`CLAUDE.md` opens with three blank lines and no title, mission or stack. That is not a
defect in the composition — it is the shape of the work `nina init` has to do. `compose`
now names those holes instead of writing them silently: **53 slots** for a profile
declaring one surface. That list is the interview `init` must conduct.
