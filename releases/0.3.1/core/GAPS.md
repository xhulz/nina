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

## Open

**The core is domain-agnostic, not stack-agnostic — deliberately.** It still names `pnpm` (49),
`vitest` (58), `Prisma` (17), `Cloudflare`/`wrangler` (18), `Hono`, `Miniflare`, `Biome`, `turbo`.
That is the single track this harness is for, and most of it is load-bearing: the qa spec's memory
discipline is a fact about vitest, not about testing. It becomes a gap only when a project on
another stack appears. The `.js`-extension and barrel-export rules are the sharpest case — they
assume a TypeScript pnpm monorepo that emits `dist/`, and `fixtures/plain` needs `PKG_SCOPE` and
`EMITTING_PKGS` in its vocabulary to compose at all. If a second stack ever arrives, those are a
`ts-monorepo` surface, not core.

**Invariant rules that landed in the project layer.** These are generically valuable but were
stated through an incident or an inventory that belongs to one project, and a false historical
claim is worse in a new project than a missing rule — it is an instruction an agent will
dutifully chase.

| Spec | What was lost to the project layer |
|---|---|
| secops | threat-model dimension #1 (AuthN / session) — it ends in "this platform already had one near-miss here", so the whole dimension went with it. A new project gets **no auth dimension at all** until this is generalized. |
| qa | the *"pre-existing failure"* paragraph — the causes it lists (`getByText` matching several elements, missing router context, `vi.mock` TDZ, jsdom without `showModal`, a hardcoded origin) are generic frontend test-harness traps; only the provenance is not |
| architect, implementer | the Route → Service → Data layering rule, stated through one project's packages |
| patterns | the *"when correcting a doc, delete what you are correcting"* lesson — one of the sharpest rules in the harness, told entirely through two spec files and a commit hash |

**A composed project is not a finished project.** With no project layer, `CLAUDE.md` opens with
blank lines and no title, mission or stack. That is the shape of the work `nina init` has to do:
`compose` names the unfilled slots — 61 for the `acme` fixture — and that list is the interview.
