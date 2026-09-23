<!-- nina:requires integrations -->
# <Name> — premises

> One integration, one doc. The **integration-tester** creates it on first contact with the
> dependency and appends to it whenever it observes behavior this file does not yet carry.
> Everything below is evidence. A claim you cannot cite belongs in *Open questions*, not in a
> premise — a premise that turns out to be a guess is how an integration regression ships.

- **Kind:** `installed-library` · `live-api` · `platform-binding` — pick one; it decides what counts as evidence.
- **Boundary:** the one module that speaks to this dependency. Nothing else may.
- **Skill:** the installed skill covering it, or *none* — do not invent one.

## Premise index

Read this table and the sections your task actually cites. Not the whole file.

| Premise | Evidence | Claim |
|---|---|---|
| P1 | `<citation>` | one sentence |

---

## P1 — <the claim, as a sentence>

**Claim.** What the dependency does, in one sentence, stated specifically enough to be wrong.

**Evidence.** The form depends on the kind:

- `installed-library` — `node_modules/.pnpm/<lib>@<version>/.../<file>:<line>`, with the lines that
  prove it quoted. From the version actually installed here, not the latest release.
- `live-api` — the request sent and the response received, verbatim, or the contract-test case that
  pins it. The vendor's documentation is not evidence: it describes what they intend, and you are
  depending on what they do.
- `platform-binding` — what the local emulator did when driven, plus the platform's installed types.

**Why it matters here.** Which code depends on this being true, and what breaks if it is not.

**Checked.** `<date>` against `<version / environment>`.

---

## Open questions

Behavior this doc does not settle yet, and what would settle it. A question here is honest work;
the same uncertainty written as a premise is a defect waiting for a deploy.
