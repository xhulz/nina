# Spec: tests for the lending rules

Kind: tests
Size: ~110 lines in 1 file

## Goal
`src/lending/loans.ts` has no tests. Add `src/lending/loans.test.ts` with the rows below. Each row
carries a `fails if` comment naming the change to `loans.ts` that turns it red, and that claim must be
true of the row.

## Files to touch
- `src/lending/loans.test.ts` — create.

## Out of scope
Every other file: `src/lending/loans.ts` does not change.

## Rows
- **LF-1** — the late fee: a loan returned three days late is charged three days at its kind's daily fee.
- **LF-2** — a loan returned on time, or early, is charged nothing.
- **LF-P** — a property over due and return dates: the late fee is never negative, and is a whole
  number of its kind's daily fee.
- **MV-1** — an open loan moves to `returned`, and to `lost`.
- **MV-2** — a final loan never moves: a move out of `returned`, and out of `lost`, is refused with its
  reason.
- **MV-3** — a move to the state a loan is already in is refused as `same-state`.
- **TR-1** — a transfer charges the sending branch the dispatch fee and the receiving branch the intake
  fee.
- **RF-1** — every refusal has a message.

## Obsolescence list
None: nothing becomes dead with this change.

## Premises
- `DAILY_FEE` is `{ book: 25, disc: 100 }` — `src/lending/loans.ts`.
- `REFUSALS` is the closed list of refusal reasons — `src/lending/loans.ts`.

## Preview deploy plan
None: tests only.
