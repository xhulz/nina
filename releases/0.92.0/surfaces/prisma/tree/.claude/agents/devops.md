<!-- nina:slot prisma.1 -->
- **`prisma-cli`** — before `migrate deploy` or any other Prisma CLI command against a real database.

<!-- nina:slot prisma.2 -->
- **Prisma migrations go out with `prisma migrate deploy`**, and nothing else changes a shared database's schema.

<!-- nina:slot prisma.3 -->
- Run `prisma migrate diff --shadow-database-url <url>` against any live database. It **executes** the migration history against that database, destroying everything in it, and reports success. Use a disposable shadow database or don't run it.

<!-- nina:slot prisma.4 -->
- Run `prisma migrate reset` against a shared database, ever.
