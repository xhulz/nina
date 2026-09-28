<!-- nina:slot prisma.1 -->
- **Database table/column names** (Prisma `@map` / `@@map`): `snake_case` in SQL, `camelCase` in TS.

<!-- nina:slot prisma.2 -->
- Where Prisma reads are cached through Accelerate, `cacheStrategy` lives in `{{DB_PKG}}`: services do not add, strip, or override cache policies.

<!-- nina:slot prisma.3 -->

### Prisma

- Schema lives in `{{DB_PKG}}/prisma/schema.prisma`. Nowhere else.
- **Never write raw SQL** unless justified in a code comment with perf data.
- N+1 is solved with `include` / `select`, chosen deliberately.
- Where reads are cached through Accelerate, every `findUnique` / `findMany` on a hot path defines its `cacheStrategy`, and no direct connection string is embedded in code.
- Tests run a real Prisma client against a real database; the client is never mocked.
