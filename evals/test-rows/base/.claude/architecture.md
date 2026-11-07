# Architecture

One module, `src/lending/loans.ts`: pure functions over a loan, no I/O. Amounts are integer cents.
A refusal is a value, never a throw: every function that can refuse returns `{ ok: false, refusal }`
with a reason from the closed list `REFUSALS`.
