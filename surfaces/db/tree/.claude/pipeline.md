<!-- nina:slot db.1 -->

### 4. DBA (mandatory for Prisma)

- **Trigger:** any change in `schema.prisma`, any new Prisma query, any migration.
- **Input:** Prisma diff + application code using the queries.
- **Output:** approve or reject with specific issues.
- **Tools:** Read, Grep, Glob, Bash (`prisma validate`, `prisma migrate diff`, query plan checks).
- **Checks:** schema validates; migration safe on large tables; index coverage; explicit `cacheStrategy` on hot reads; **no cache on a read that feeds a correctness-critical write**; **`userId` scope in every query**; no N+1; no raw PII without encryption; the connection secret comes from the environment, never from code.
- **Position:** dispatched mid-pipeline by whoever detects Prisma. Reviewer verifies dba ran.

<!-- nina:slot db.2 -->
  - **If Prisma touched → dba approved.**
