# Code map

A branch library's lending rules.

- `src/lending/loans.ts` — late fees by item kind, the moves a loan may make, renewals, the charges
  of a transfer between branches, and the message for each refusal.

Invariants: `returned` and `lost` are final states; a late fee is never negative; every refusal
reason in `REFUSALS` has a message.
