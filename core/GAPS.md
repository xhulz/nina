# Known gaps

The harness was extracted by slicing one live project, and a slice cannot be cleaner than the
thing it was cut from. This file tracks what is still shaped by that origin.

## Closed

**Domain examples in the core.** The extraction had to leave money and PII nouns in otherwise
invariant rules, because byte-exact recomposition was the proof that nothing was lost and
rewriting a line broke it. Once projects started pinning a release, that constraint lifted:
the core no longer names payouts, escrow, KYC, PIX, CPF or a single provider, and the
`db` surface no longer assumes the write it protects is a money movement. `fixtures/acme`
holds the line — it declares no `money` and no `pii` surface, and the test fails on any of
those words reappearing.

**The single-provider assumption.** `external-api` became `integrations`, plural, cut by how
a premise is settled (`installed-library` / `live-api` / `platform-binding`) rather than by
one project's payment provider.

**The `money` surface was one project's money path.** It shipped that project's state machine
(`DETECTADA → CASADA | DIVERGENTE | SEM_REGRA`) as a harness rule, named its models, its
currency and its escrow vocabulary, and assumed one payment provider. It now states the
invariants and nothing else: conservation, idempotency of an irreversible send, one
serialization point per balance, integer minor units, and a state machine the **project**
declares in its own `.claude/architecture.md`. `fixtures/ledger` holds that line — a money
project whose minor unit is `cents`, whose engine is `packages/settlement`, and whose deny
list fails on `escrow`, `centavos`, `Payout`, `DETECTADA` or any of the rest reappearing.

**The `pii` surface was one country's regime.** It named CPF/CNPJ, PIX keys, KYC documents, LGPD,
R2 and Postgres as if they were universal categories. It now says that sensitive categories are
**declared by the project** in its own `.claude/architecture.md`, and states what is invariant:
classified, encrypted at rest, never in a log, an error, a URL, an analytics event or an agent
transcript, and document bytes only in the object store. `fixtures/ledger` declares `pii` with a
`GDPR` regime and fails on any of the old words returning.

**Incident dates that read as false history.** Five places told a rule through a date it happened
on — a wiped database on 2026-09-16, a blocked deploy on 2026-09-21, specs split across two
directories before 2026-09-04. In the project where it happened that is provenance; in a new one it
is a claim about a past it does not have, and an agent will go looking for it. The rules keep their
force without the date: *"the command completes with a reassuring 'empty migration' result and no
error, having already destroyed everything in the database it was pointed at."*

**A rule cross-reference that pointed at nothing.** The hard rules are one numbered list assembled
from several layers, so a project that declares no `integrations` surface has no rule 12 — while the
core still said "the premise rule (#12 below)". `compose-test` now checks every `Hard Rule #N`
against the rules the project actually composed, and `fixtures/plain` declares no surface at all, so
the most reduced case is exercised on every run.

**Invariant rules that landed in the project layer.** Four rules were generically valuable but were
stated through an incident or an inventory belonging to one project, so the project layer swallowed
them and a new project got nothing. Each was restated in the layer that actually owns it:

| Spec | What it got back |
|---|---|
| secops | the **AuthN / session** dimension is now core: credential issuance and consumption, cookie flags, fixation across a privilege change, origin allowlist, and any dev bypass that could reach production. The project slot survives for the auth library and the bypasses that project actually has. |
| qa | the *"pre-existing failure"* traps moved to `surfaces/frontend` — they are facts about a jsdom + vitest harness, not about one feature. The project slot held only the provenance, so it was dropped. |
| architect, implementer | both specs now state the Route → Service → Data rule themselves instead of only `patterns.md` stating it. The project slot survives for the package names. |
| patterns | *"when correcting a document, delete what you are correcting"* is now a core section. |

**The threat model was numbered, and the numbers came from slots.** Dimensions 1–8 lived in surface
fragments and 9–10 in the core, so a project declaring every surface got 1–10 and everyone else got
a list with holes: `acme` read `2, 3, 6, 8, 9, 10`, and a surfaceless project began at **9**. The
list is bullets now, valid under any combination. The core's rate-limiting dimension also named one
project's auth strategy (`magic-link request, dev routes`); it says `issues a credential` instead.

**A surface's technology was named in files nothing gated.** The item above used to bundle two
different things under "stack-specific", and only one of them was a choice. `Prisma` appeared in 7
ungated core files and Cloudflare's runtime in 10 — technologies that already *have* surfaces, named
in text every project composes. A frontend-only project read a `CLAUDE.md` that discussed Prisma, a
`patterns.md` headed *API (Cloudflare Worker / Hono) conventions*, and a qa spec telling it to kill
stray `workerd` processes that could not exist. The reviewer even pointed at `CLAUDE.md` §
*Cloudflare plugin skills*, a section that lives in the edge-cf surface — a dangling cross-reference
of exactly the kind already closed once here.

42 sites were fixed by saying what the rule means rather than which product implements it: "if the
database was touched" instead of "if Prisma touched", "deploy config" instead of "wrangler config",
"the local emulator" instead of "Miniflare". None of it lost precision, because the instruction was
never about the product. Where a genuine specific was worth keeping it moved into `surfaces/edge-cf`
behind a slot.

The deny lists never caught this, and could not: they guard one fixture's output against *domain*
leaks, and a substring match makes a word like `Hono` unusable because it fires on `Honor`. The
guard is now a layer audit in `compose:test` — for every core file, a surface's technology may be
named only if the file is gated on that surface. It asks the question once, of everything, instead
of only of what a fixture happens to compose.

**Money in the core, and the heavy-gate list that carried it.** The extraction closed money's nouns
(payout, escrow, the state machine) but not the word itself: ten places in the core listed "money, the
database, auth, an integration" as the changes that are always gated in full, so a project with no
money was told that under-gating a money movement was a protocol violation, and its devops that a
production deploy "moves real money". The audit now holds `money` like a technology, and found 19 of
them. The list is one definition of **critical paths** in `CLAUDE.md` — auth in the core, and the
database, an integration boundary, money movement, personal data and contract code each added by its
own surface — and the ten places say "a critical path". Two copies of money's own rules had also
landed in `surfaces/db` (`BigInt` columns, a money-integrity check in the dba's report), contradicting
the money surface's integer minor unit; they are gone, since the money surface already says it better.
The same pass found Cloudflare's `Pages`, `Worker` and a capitalised `Wrangler` in the core and in
two surfaces, and the leftovers no audit could name: a model called `DestinationAccount` and a spec
set called `retention-spec1..8` in the router's examples, "all nine stages" where a profile composes
seven to eleven, `userId` as the name of owner scoping, and "the harness's first three months" told
as the history of whichever project was reading it.

## Open

**The core is domain-agnostic, not stack-agnostic — deliberately.** It still names `pnpm` (49),
`vitest` (50), `TSDoc` (12), `TypeScript` (6), `Biome` (4) and `turbo` (4). That is the single track
this harness is for, and most of it is load-bearing: the qa spec's memory discipline is a fact about
vitest, not about testing. Unlike the surface leak above, this is not a defect — there is no
`pnpm` surface a project could decline. It becomes a gap only when a project on another stack
appears. The `.js`-extension and barrel-export rules are the sharpest case — they assume a
TypeScript monorepo that emits `dist/`, and `fixtures/plain` needs `PKG_SCOPE` and `EMITTING_PKGS`
in its vocabulary to compose at all. If a second stack ever arrives, those are a `ts-monorepo`
surface, not core.

**A composed project is not a finished project — by design.** With no project layer, `CLAUDE.md`
still opens with blank lines and no title, mission or stack. That is not a defect to fix in the
core: the missing text is the part only this project can say. `init` conducts the interview and
writes it to `.nina/TODO.md`, and it deliberately writes **no stub fragments**, because a stub is
a filled slot as far as every tool is concerned — a tree of TODOs would compose and check clean
while saying nothing. So `compose` keeps naming the unfilled slots until a person fills them, and
the blank opening is that list being honest rather than the core being incomplete.
