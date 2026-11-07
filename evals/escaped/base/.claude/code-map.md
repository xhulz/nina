# Code map

- `src/tickets/` — the box office's rules, one module per concern, each with its tests beside it.
  `keys.ts` holds `parseSeatKey`, the one reader of a client's seat key, and `errors.ts` the named errors.

Invariants: a seat number read from a key is that key's own seat, never another's; a request about a seat
someone else holds is answered exactly as one about a seat that does not exist, so nobody learns which
seats are held.
