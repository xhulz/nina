# Spec: seat holds

Kind: new
Size: ~260 lines in 6 files

## Goal
A buyer can hold seats before paying. Add holds, their limits and prices, the receipt check, the release
queue's handler and the answer a buyer gets about a hold, each tested.

## Files to touch
- `src/tickets/keys.ts` — modify: `parseSeatKey` also reads the row mark, so `R12` names seat 12, as `12`
  does. Every key it accepts is still read back as its own seat number, never another's.
- `src/tickets/holds.ts` — create: `hasLiveHold`, `changeLimits`, `setHoldPrice`.
- `src/tickets/receipts.ts` — create: `mentions`, which says whether a receipt holds a text anywhere.
- `src/tickets/queue.ts` — create: `handleRelease`, which logs each release by its message's id.
- `src/tickets/api.ts` — create: `holdAnswer`.
- `src/tickets/tickets.test.ts` — create: the rows below, each with a `fails if` comment naming the
  change that turns it red.

## Out of scope
`src/tickets/orders.ts` and its tests: no caller of `parseSeatKey` changes.

## Rules
- A hold is live while it is `held` or `paid`; a `released` hold is gone.
- Limits: `perOrder` in 1–8 and `perDay` in 1–20. A limit outside its range is refused even when it
  equals the stored one — a stored limit can fall outside after a range is narrowed — and only a change
  within range to the stored values is `unchanged`.
- A price is an integer of cents in 0–`MAX_PRICE`. A refused price writes nothing.
- `mentions` reads every string a value reaches through its objects and arrays, each object once.
- A request about a seat someone else holds is answered exactly as one about a seat nobody holds:
  status, body and headers.

## Rows
- **SK-1** — `12` and `R12` both name seat 12; a key with a leading zero is refused.
- **HL-1** — a live hold is found whether it is `held` or `paid`; a `released` one is not.
- **LM-1** — a change within range is applied, one equal to the stored limits is `unchanged`, and a limit
  out of range is refused, whether or not it equals the stored one.
- **PR-1** — a price in range is set; one out of range is refused and writes nothing.
- **RC-1** — a needle anywhere in a receipt is found, a receipt without it is clean, and a cycle ends the
  walk without hiding what sits beside it.
- **QU-1** — a release is logged with its message's id. Each fixture message carries a distinctive `id`.
- **AN-1** — a buyer sees their own hold; a seat held by someone else and a seat nobody holds get the
  same answer, status, body and headers.

## Obsolescence list
None: nothing becomes dead with this change.

## Premises
- `orderOf` reads every key through `parseSeatKey` — `src/tickets/orders.ts`.

## Preview deploy plan
None: this change is not deployed on its own.
