<!-- nina:slot db.1 -->
| Run any `prisma` CLI command (dba, integration-tester, devops) | `prisma-cli` | flags differ between versions; `migrate diff --shadow-database-url` against a live DB wiped dev/staging once |

<!-- nina:slot db.2 -->
| Write or audit a Prisma query (architect, implementer, dba, reviewer) | `prisma-client-api` | filters, operators, `$transaction` semantics. a caching or edge layer on top of the client is **NOT covered** — its cache strategy belongs to that layer's own integration doc |

<!-- nina:slot db.3 -->
| **ANY Prisma change (`*.prisma` or new query)** | **+ dba before reviewer** |

<!-- nina:slot db.4 -->
- **dba** → mandatory gate on Prisma schema changes, migrations, and new queries

<!-- nina:slot db.5 -->
2. **Every Prisma change goes through the dba subagent.** No exceptions. Reviewer must verify dba ran before approving.

<!-- nina:slot db.6 -->
6. **Every hot Prisma read defines a `cacheStrategy`** (Accelerate `ttl` / `swr`). Implicit cache is a bug. **Never cache a read that feeds a write whose correctness depends on it being fresh** — a stale row contaminates every decision made from it. User-scoped invalidation on every write.

<!-- nina:slot db.7 -->
7. **Tenant isolation is enforced in the data layer.** Every Prisma query in app code includes `userId` (the tenant) in the `where` clause. No "global" queries except the {{AUTH_LIB}} system tables. Reviewer rejects any query missing the scope.
