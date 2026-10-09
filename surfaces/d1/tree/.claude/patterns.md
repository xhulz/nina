<!-- nina:slot d1.1 -->

### D1

- **No interactive transaction, through any client.** A transaction call sends `begin`, which D1 refuses, and the type checker accepts the call. The atomic unit is one D1 batch: a failing statement rolls the whole batch back (observed under the local emulator). Whether a client's batch call is one D1 batch, and which items it can hold, is cited from the integration doc.
- **A batch rolls back on an error, not on "0 rows changed".** A write that must not happen when an earlier one changed nothing carries its guard in SQL inside the same batch — a statement that fails when the condition does not hold. A `changes() = 0` guard reads only the statement right before it.
- **At most 100 bound parameters per statement** (the emulator ran 100 and refused 101). A lookup by a list of ids, with its tenant filter, and a multi-row insert, at rows × columns, are chunked to stay within it.
- **Each row written counts once per index it touches**, the primary key's included, against a plan's rows-written quota.
