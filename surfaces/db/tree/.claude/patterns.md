<!-- nina:slot db.1 -->
- **Database table/column names** (Prisma `@map` / `@@map`): `snake_case` in SQL, `camelCase` in TS.

<!-- nina:slot db.2 -->
1. Routes must NOT import query functions (`list*`, `find*`, `get*`, `upsert*`, `delete*`) from `{{DB_PKG_NAME}}`. Only `createDbClient` and error classes.

<!-- nina:slot db.3 -->
4. `cacheStrategy` lives in `{{DB_PKG}}`. Services do not add, strip, or override cache policies.

<!-- nina:slot db.4 -->
5. **Every service query includes `userId` (tenant scope) in the `where` clause.** Missing scope = automatic CHANGES REQUESTED.

<!-- nina:slot db.5 -->

---

## Prisma conventions (enforced by dba subagent)

- Schema lives in `{{DB_PKG}}/prisma/schema.prisma`. Nowhere else.
- **Never write raw SQL** unless justified in a code comment with perf data.
- **Every `findUnique` / `findMany` on a hot path defines `cacheStrategy`.** No implicit cache.
- **NEVER cache a read that feeds a write whose correctness depends on it being fresh.** A stale row contaminates the decision made from it. Hard reject in dba review.
- **Every query in app code includes `userId` in the `where` clause** (or its model-specific equivalent FK). Tenant isolation is in the data layer. The {{AUTH_LIB}} system tables are the only exemption.
- Migrations reviewed by **dba** for: non-blocking on large tables, index coverage for new query patterns, backward compatibility during rolling deploy.
- N+1 queries are a bug. Use `include` / `select` deliberately.
- `Prisma Postgres` is connected only via Accelerate. Local dev uses the same Accelerate URL pointed at a dev DB; never embed a direct connection string in code.

<!-- nina:slot db.6 -->
- Real Prisma (Accelerate against a test DB). Never mock Prisma.
