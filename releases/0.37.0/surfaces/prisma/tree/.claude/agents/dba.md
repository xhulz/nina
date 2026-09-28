<!-- nina:slot prisma.1 -->
| `prisma-cli` | **before ANY `prisma` CLI command** — `validate`, `format`, `migrate dev`, `migrate diff`, `migrate deploy`. Flags differ between versions, and one of them (`migrate diff --shadow-database-url` against a live database) destroys the database it points at |
| `prisma-client-api` | auditing a new or changed query — filters, operators, `$transaction` semantics |

<!-- nina:slot prisma.2 -->
Neither skill covers a **caching or edge layer sitting on top of the client** — cache strategy,
edge-client behaviour and the rule about never caching a read that authorizes a write belong to that
layer's own integration doc, declared like any other integration. A skill does not replace it.

<!-- nina:slot prisma.3 -->
- **With Prisma, both offline.** Run `pnpm --filter {{DB_PKG_NAME}} exec prisma validate`; it must pass. Then run `prisma migrate diff` in its **offline, file-only form** and read the generated SQL, not just the Prisma delta:

   ```
   # Compare the PREVIOUS schema against the working one — pure file-to-file, no database.
   git show HEAD:{{DB_PKG}}/prisma/schema.prisma > /tmp/schema-head.prisma
   pnpm --filter {{DB_PKG_NAME}} exec prisma migrate diff \
     --from-schema-datamodel /tmp/schema-head.prisma \
     --to-schema-datamodel prisma/schema.prisma \
     --script
   ```

   A first schema has nothing at `HEAD`: diff it `--from-empty`. Compare the output against the
   hand-written `migration.sql` to confirm the declarative parts match.

   ⚠️ **Do NOT reach for `--from-migrations`.** It looks like the natural choice and it is a trap:
   Prisma refuses it without `--shadow-database-url`, which pushes you toward supplying a database
   URL — the exact move that destroys databases (below). The two-datamodel form above answers the
   same question with no database involved.

   ⛔ **NEVER pass `--shadow-database-url`, `--from-url`, `--to-url`, or `--from-schema-datasource` pointing at a real database — most of all not the `DATABASE_URL` in `{{SECRETS_LOCAL}}`.** Prisma **executes** the entire migration history against whatever database those flags name, which **DESTROYS ALL DATA** in it. A shadow database must be a disposable, empty database and nothing else. It does not announce itself: the command completes with a reassuring "empty migration" result and no error, having already destroyed everything in the database it was pointed at. If the offline form above cannot answer your question, **STOP and report that to the orchestrator** instead of reaching for a database URL.

<!-- nina:slot prisma.4 -->
- **Where reads are cached through Prisma Accelerate,** every `findUnique` / `findMany` on a hot read path names its `cacheStrategy` (`ttl` / `swr`), and one that feeds a correctness-critical write names none.

<!-- nina:slot prisma.5 -->
- **On an edge runtime,** new Prisma code paths use `@prisma/client/edge`.

<!-- nina:slot prisma.6 -->
- Run a Prisma command that writes to a real database — `prisma migrate dev`, `migrate deploy`, `migrate reset`, `migrate resolve`, `db push`, `db execute`, `$executeRaw*` — or **any `prisma migrate diff` variant carrying a database URL**, which silently wipes the database it points at.
