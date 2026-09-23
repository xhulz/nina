<!-- nina:slot db.1 -->
- **`prisma-cli`** — before `migrate deploy` or any other Prisma CLI command against a real database.

<!-- nina:slot db.2 -->
4. **Migrations, in order, against the right database.** Apply with `prisma migrate deploy`. Confirm the target `DATABASE_URL` is the one you intend. Verify the migration is backward-compatible with the currently-deployed code, because the two are live together during the rollout.

<!-- nina:slot db.3 -->
- Run `prisma migrate diff --shadow-database-url <url>` against any live database. It **executes** the migration history against that database — this wiped dev and staging on 2026-09-16. Use a disposable shadow database or don't run it.

<!-- nina:slot db.4 -->
- Run `prisma migrate reset` against a shared database, ever.

<!-- nina:slot db.5 -->
- **Migrations:** applied / none, with the database they hit.
