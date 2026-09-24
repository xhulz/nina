<!-- nina:slot db.1 -->
| `prisma-client-api` | a new or changed Prisma query |

<!-- nina:slot db.2 -->
- **Tenant-scope impact** — explicitly state where `userId` is enforced. Every new Prisma query in app code includes `userId` (or its model-specific FK equivalent) in the `where` clause. The only exempt tables are the {{AUTH_LIB}} system tables.

<!-- nina:slot db.3 -->
- **Prisma flag** — if `schema.prisma` or a new Prisma query is touched, mark **"DBA REQUIRED"** prominently at the top of the spec. Specify the proposed `cacheStrategy`, or **`NO_CACHE`** for any read that feeds a write whose correctness depends on it being fresh — a stale row contaminates every decision made from it.
