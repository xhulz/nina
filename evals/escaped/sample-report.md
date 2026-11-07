VERDICT: REJECTED
ISSUES: key-unbounded, hl1-fixture, an1-headers

The line after ISSUES: the implementer owns every fix.

- `src/tickets/keys.ts:4` — the bound on the digits is gone: past 2^53 `parseInt` reads two keys as one seat.
- `src/tickets/tickets.test.ts:37` — HL-1 holds a paid and a held hold together, so counting only held ones still passes.
- `tickets.test.ts:95` — AN-1 never compares the headers the spec names.
- `src/tickets/api.ts:20` — `notFound` could be a constant.

Tests: each row names its mutation.
Artifacts checked: the spec's files against the tree.
