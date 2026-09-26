# Moving a project forward, and cutting a release

`upgrade`, and why a release is frozen. Read before touching `src/commands/upgrade.mjs`, `src/steps.mjs`, `src/commands/release.mjs` or `src/expected.mjs`, or before cutting a release.

```bash
nina upgrade --project ../thing --to 0.3.0  # what would moving cost? (reports; writes nothing)
nina upgrade --project ../thing --to 0.3.0 --apply
```

`upgrade` exists for one risk. What breaks in an upgrade is not the harness; it is the text the
**project** already wrote that the new core has nowhere to put. A fragment whose slot was renamed or
dropped composes to nothing, and no check notices, because nothing is missing — it is just gone. So
`upgrade` reports first and refuses to apply while anything would lose meaning. Reconciling fragments
is work, and work does not get done by a flag.

What `--apply` does do is run the rest of the move, because the rest was six commands in a fixed
order and a procedure nobody can hold in their head is not a procedure — getting the order wrong
overwrote a project's own file:

```
  pinned 0.13.0
  ✓  composing the harness files — 17 file(s)
  ✓  checking the declaration — check: declaration is sound
  ✓  validating the pills — pills: all 13 well formed
  ✓  running the project's own detectors — harness: current (4 detectors clean)

  upgrade: 0.7.0 → 0.13.0 applied and verified.
```

A step that fails **puts the project back**: the old version is pinned again, the tree is recomposed
against it, and the failing step's own output is printed. The pin and the composed files move
together or not at all, because a project pinned to one version and composed from another is the
one state nothing downstream reports.

Every step that is re-run after the move is also measured **before** it, and one the project was
already failing is reported rather than rolled back for — otherwise the upgrade takes the blame for a
problem it found rather than caused. Measured is the operative word: this held for the validations and
not for the project's own detectors, so `check` was excused for an open slot while the detector step,
reading that same fact through a different command, put the whole move back. They are one list now, so
a step added later is measured without anyone remembering to measure it.

Measured means the findings, not the exit code. A step that was failing before used to be excused
whole, so a project already missing one hook had everything else the move broke in that step waved
through with it. It is excused now only for what it already said: a failure the move added is the
move's doing, and rolls it back — or, under `--force`, is listed once the move is done. Notes are not
failures, so a slot the move creates, reported as a note, can never roll it back.

Compose writes and never deletes, so the move does the deleting. Right after it composes — before
anything is verified, so what is verified is what stays — it removes the files the old version composed
and the new one does not, unless they carry edits of the project's own, which are kept and named. If it
rolls back, it removes the files it composed for the first time, recomposes the old version, and then
writes back every file the move could touch exactly as it was — the recompose alone used to write the
old composition over the owner's own edits and call the tree restored. A file of the project's own at a
path the new version starts composing is refused in the preview; under `--force` it is replaced, with a
copy kept in `.nina/replaced/` first. Without that, a rolled-back move left the new version's
loop gate on disk, run by hooks the owner had just wired for it, on a pin that has no gate. Hooks a move
needs cannot be forced past either: `upgrade` prints them and refuses until
`nina wire --to <version> --apply` has put them in.

There is one failure it must **not** roll back for: a project slot the move itself creates. A new core
can introduce one, and it cannot be filled before the core that introduces it is pinned — so failing
on it leaves no order in which the upgrade ever completes. The preview already works out which slots
are new, so those are named to every validation that fails on one: `check` by flag, and the project's
own `compose --check` through the environment, because that one is reached through an npm script whose
arguments this command does not own. Both read the list from `src/expected.mjs` rather than parsing
their own, since the first fix taught one of the two and the deadlock simply moved one step down the
chain. The exemption is exactly as wide as the slots named and lasts exactly as long as the move: the
next `harness:check` reports them again, and the success line names them, because a move that composed
a hole and said "verified" is the silence this harness exists to remove.

A vocabulary name only the new core uses is the same case, and was missed until a real move hit it: the
preview listed `{{TENANT_KEY}}` as needed, and `check` then rolled the move back for it. Such names ride in
the same list, written `{{NAME}}`, and are named again once the move succeeds. A name the old core already
used and the profile left empty is not excused: that failure was there before the move, and is measured as
one.

## Releases — why work here does not move a project that is shipping

A project pins a frozen version of the harness in its profile (`"core": "0.1.0"`), and
composes from `releases/<version>/` rather than from the working `core/` and `surfaces/`.
Without that, the first edit here makes every consuming project's composition detector
report drift on every turn — the same noise the detectors exist to remove.

```bash
nina release 0.2.0      # freeze the working core + surfaces; releases are never rewritten
```

The cut also writes the package's own `version`. The package **ships** `releases/`, so a package
number below the newest release describes nothing that is inside it — 0.5.1 shipped releases
through 0.7.0 because two cuts went by without a bump, and the banner announced the stale number
for both. Cutting is the one moment the compiler and the layers are known to agree, so that is
where the number is written rather than remembered. The field is replaced on its line, not by
re-serializing the parsed object: a round trip rewrites every line of the file, and on a
`package.json` with no `version` at all it would invent one.

The consequence worth accepting: a compiler-only change still cuts a release, whose layers are
byte-identical to the one before it. That costs ~400 KB and keeps one number meaning one thing.
A project does not follow it — pins move only through `nina upgrade`.

Cutting a release **changes what `init` does**, because `init` pins the newest one when none is
named — a new surface starts being offered the moment it is frozen. So the suite runs *after* the
cut, not only before it: a release is the one repo operation whose effect is not in the diff. The
newest is chosen by number rather than as text, or `0.10.0` would sort below `0.9.0` and a command
that defaults to the newest would quietly pin the one before it.

A profile that pins a release which is not in `releases/` is an **error**, not a fall back to
the working tree: composing an unreviewed core into a project that asked for a reviewed one
is the kind of thing nothing downstream would report. A project tracks the working tree
deliberately, with `"core": "dev"`.

Consuming projects run `--check` as a detector inside their own `harness:check`, so a hand
edit to a generated file reports as drift. If a change makes a core file expect text that no
declared layer provides, `compose` names the unfilled slots instead of writing a hole.
