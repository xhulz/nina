VERDICT: REJECTED
ISSUES: one-kind, equal-fees, hand-list

The line after ISSUES: the implementer owns every fix.

- `src/lending/loans.test.ts:27` — LF-1 lends only a book, and so does every lateFee row: charge every kind the book's fee and all of them pass. Add a disc.
- `loans.test.ts:68` — dispatch and intake are both 150: swap them in `transferCharges` and TR-1 stays green.
- `src/lending/loans.test.ts:76` — RF-1 iterates a list written by hand that has no `overdue`; iterate `REFUSALS`.
- `src/lending/loans.test.ts:46` — MV-1 could assert the whole result rather than a match.

Tests: each row names its mutation.
Artifacts checked: the spec's rows against the file.
