<!-- nina:slot db.2 -->
- A new query on a cached read path — verify the cache's behavior live (dba covers the schema; you cover how the cache behaves at runtime)

<!-- nina:slot db.3 -->
If a query behaves differently against a real database than the dba's static analysis suggested, escalate to **dba** — do not fix it yourself.

<!-- nina:slot db.4 -->
- **The auth library's backing store is a real database** — the development database, the same
  connection the implementer uses from `{{SECRETS_LOCAL}}`. A suite that is green against an
  in-memory stand-in has not exercised the library, which is the whole point of this stage.
