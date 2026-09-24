<!-- nina:slot db.1 -->
| `prisma-cli` | **before ANY `prisma` CLI command** — `validate`, `format`, `migrate dev`, `migrate diff`, `migrate deploy`. Flags differ between versions, and one of them (`migrate diff --shadow-database-url` against a live database) destroys the database it points at |
| `prisma-client-api` | auditing a new or changed query — filters, operators, `$transaction` semantics |

<!-- nina:slot db.2 -->
Neither skill covers a **caching or edge layer sitting on top of the client** — cache strategy,
edge-client behaviour and the rule about never caching a read that authorizes a write belong to that
layer's own integration doc, declared like any other integration. A skill does not replace it.

<!-- nina:slot db.3 -->
- Any change to `{{DB_PKG}}/prisma/schema.prisma`.
- Any new Prisma query (`findUnique`, `findMany`, `create`, `update`, `delete`, `aggregate`, `$queryRaw`, etc.) anywhere in application code.
- Any migration generated via `prisma migrate`.

<!-- nina:slot db.4 -->
- The Prisma diff (schema changes + generated migration SQL).
- The application code that uses the new or modified queries.

<!-- nina:slot db.5 -->
**Read `.claude/code-map.md`** when the change touches new query patterns — it lists which services consume which Prisma models, so you can spot N+1 risk and consumer-side cache implications without re-grepping. (Greenfield phase: fall back to `.claude/architecture.md` § *Database* for the planned schema — the model table, monetary conventions, and the Accelerate cache-policy table are canonical there.)

<!-- nina:slot db.6 -->
- **Schema validates.** Run `pnpm --filter {{DB_PKG_NAME}} exec prisma validate`. Must pass.

<!-- nina:slot db.7 -->
- **Migration diff.** Run `prisma migrate diff` in its **offline, file-only form** and read the generated SQL, not just the Prisma delta:

   ```
   # Compare the PREVIOUS schema against the working one — pure file-to-file, no database.
   git show HEAD:{{DB_PKG}}/prisma/schema.prisma > /tmp/schema-head.prisma
   pnpm --filter {{DB_PKG_NAME}} exec prisma migrate diff \
     --from-schema-datamodel /tmp/schema-head.prisma \
     --to-schema-datamodel prisma/schema.prisma \
     --script
   ```

   ⚠️ **Do NOT reach for `--from-migrations`.** It looks like the natural choice and it is a trap:
   Prisma refuses it without `--shadow-database-url`, which pushes you toward supplying a database
   URL — the exact move that destroys databases (below). The two-datamodel form above answers the
   same question with no database involved. Compare its output against the hand-written
   `migration.sql` to confirm the declarative parts match.

   ⛔ **NEVER pass `--shadow-database-url`, `--from-url`, `--to-url`, or `--from-schema-datasource` pointing at a real database — most of all not `DATABASE_URL` from `{{API_DIR}}/{{SECRETS_LOCAL}}`.** Prisma **executes** the entire migration history against whatever database those flags name, which **DESTROYS ALL DATA** in it. A shadow database must be a disposable, empty database and nothing else. This is not hypothetical, and it does not announce itself: the command completes with a reassuring "empty migration" result and no error, having already destroyed everything in the database it was pointed at. If the offline form above cannot answer your question, **STOP and report that to the orchestrator** instead of reaching for a database URL.

<!-- nina:slot db.8 -->
- **Migration safety on large tables:**
   - No `ALTER TABLE ... ADD COLUMN NOT NULL` without a safe default (causes lock + rewrite).
   - No operations that hold long locks without an explicit batched strategy.
   - Non-breaking for rolling deploy — old application code and new schema must coexist during the deploy window.

<!-- nina:slot db.9 -->
- **Index coverage.** Every new query pattern (`WHERE`, `ORDER BY`, `JOIN`, `aggregate`) must be backed by an index. Use `@@index` in schema. Reject queries that would table-scan. The most-used compound index is `(<tenant>, <other>)` or, for models keyed by a parent entity, `(<parentId>, <other>)`; verify the leading column matches the query.

<!-- nina:slot db.10 -->
- **userId scope.** Every query in app code must include `userId` in `where` (or the model's equivalent FK chain — `accountId`/`entryId`/`ruleId` resolving back to the owning user). The {{AUTH_LIB}} system tables are the only exemption. Reject any app query missing the scope.

<!-- nina:slot db.11 -->
- **Cache strategy.** Every `findUnique` / `findMany` on a hot read path has an explicit `cacheStrategy` (Accelerate `ttl` / `swr`). **Implicit cache is a bug — reject.** Cross-check the policy against the cache-policy table in `.claude/architecture.md` § *Database*.

<!-- nina:slot db.12 -->
- **N+1 patterns.** If the code fetches a list then queries per item, reject with "use `include` / `select` or batch."

<!-- nina:slot db.13 -->
- **Secrets.** `DATABASE_URL` (Prisma Postgres / Accelerate URL) must come from `{{SECRETS_LOCAL}}` locally and `{{SECRETS_PROD}}` in production — never `.env` committed.

<!-- nina:slot db.14 -->
- **Run ANY command that can write to a real database.** You are a read-only gate. Against a live
  `DATABASE_URL` you may run `SELECT`-only queries and nothing else. Explicitly forbidden, no
  exceptions: `prisma migrate dev`, `migrate deploy`, `migrate reset`, `migrate resolve`,
  `db push`, `db execute`, `$executeRaw*`, and **any `prisma migrate diff` variant carrying a
  database URL** (see the *Migration diff* check — that one silently wipes the database it points at). If a check
  seems to require writing, it does not: report the limitation to the orchestrator instead.

<!-- nina:slot db.15 -->
- Approve without actually running `prisma validate` and the offline `prisma migrate diff` of the *Migration diff* check.

<!-- nina:slot db.16 -->
- Wave through "small" schema changes. Small changes cause the worst production incidents.

<!-- nina:slot db.17 -->
- Approve a query missing `userId` scope (or its equivalent owning FK) in app code.

<!-- nina:slot db.18 -->
**Final report format:** ≤300 words if approved. Sections: Schema validation result, Migration SQL preview (verbatim if non-trivial), Index analysis, userId-scope check, Cache strategy verdict, Privacy check, Final verdict. If rejected, list each issue with required action — no length cap.
