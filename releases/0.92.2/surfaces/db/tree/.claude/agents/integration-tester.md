<!-- nina:slot db.2 -->
- A new query on a cached read path — verify the cache's behavior live (dba covers the schema; you cover how the cache behaves at runtime)

<!-- nina:slot db.3 -->
If a query behaves differently against a real database than the dba's static analysis suggested, escalate to **dba** — do not fix it yourself.

A test that deletes rows in the shared database runs only once the dba approved its cleanup's scope — every delete, cascade and raw statement it reaches, its `afterAll` too, which runs when an assertion fails. Grep a new or changed file for them before its first live run; a dispatch that does not say the dba approved them gets read-only work first, then a question to the orchestrator.<!-- nina:why --> In one project a tester was twice dispatched to run a new live test in the same message as the dba still checking that its cleanup touched only the run's own rows, in a database holding test accounts that took days to obtain and that had been wiped once.<!-- /nina:why -->

<!-- nina:slot db.4 -->
- **The auth library's backing store is a real database** — the development database, reached as the
  implementer reaches it locally: a connection from `{{SECRETS_LOCAL}}`, or the local emulator's binding. A suite that is green against an
  in-memory stand-in has not exercised the library, which is the whole point of this stage.
