<!-- nina:slot db.1 -->

### DBA (mandatory for the database)

- **Trigger:** any schema change, any new query, any migration.
- **Input:** the schema diff and its migration SQL + the application code using the queries.
- **Output:** `APPROVED`, or `REJECTED` with specific issues.
- **Tools:** Read, Grep, Glob, Bash (schema validation, an offline migration diff, query-plan checks).
- **Checks:** schema validates; migration safe on large tables; index coverage; an explicit policy on every cached read; **no cache on a read that feeds a correctness-critical write**; **tenant scope in every query**; no N+1; no raw PII without encryption; the connection secret comes from the environment, never from code.
- **Position:** beside the reviewer, when a diff touches the schema, a migration or a query; `qa` waits for its `APPROVED`.

<!-- nina:slot db.2 -->
  - **If the schema or a query was touched → dba approved.**
