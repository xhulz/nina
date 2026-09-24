# Code map

A notes API, framework-agnostic: each route is a function from an authenticated owner and path
parameters to a status and a body.

- `src/server/routes/` — one handler per endpoint. Calls services only.
- `src/server/services/` — business rules: owner scoping, date formatting, named errors.
- `src/server/data/` — the store. An in-memory map stands in for the database.
- `src/server/errors.ts` — the named errors services throw and routes translate.

Invariant: a note is only ever read or changed by its owner; anyone else gets the same 404 as a
note that does not exist.
