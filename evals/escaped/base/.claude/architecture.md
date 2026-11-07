# Architecture

A box office's seat rules: pure functions over plain data, no I/O. Amounts are integer cents. A refusal
is a thrown named error from `src/tickets/errors.ts`, and a refused change writes nothing. A seat key is
what a client sends; `parseSeatKey` turns it into a seat number, and every module that takes a key goes
through it.
