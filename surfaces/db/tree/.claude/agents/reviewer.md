<!-- nina:slot db.1 -->
| `prisma-client-api` | a new or changed Prisma query |

<!-- nina:slot db.2 -->
- **If Prisma was touched anywhere in the diff: confirm `dba` ran and approved. If not → dispatch `dba` now, or request changes. No approval without dba sign-off on Prisma changes.**

<!-- nina:slot db.3 -->
- Check for **single-user tenant scoping** in every new Prisma query in app code: the `where` clause must include `userId` (or its model-specific FK equivalent). No "global" queries except the {{AUTH_LIB}} system tables. Missing scope = request changes.

<!-- nina:slot db.4 -->
- Check for N+1 queries when the DB layer was touched.

<!-- nina:slot db.5 -->
- **tenant-and-privacy** — `userId` in every app query ({{AUTH_LIB}} tables are the only exemption);
  no PII or secrets in logs; no cross-tenant read
  or write reachable through a route, an MCP tool, a webhook, or an RPC between services.

<!-- nina:slot db.6 -->
- `{{DB_PKG}}/prisma/schema.prisma` touched (Prisma migration in play)

<!-- nina:slot db.7 -->
- Skip the dba check on Prisma changes "because it seems fine."

<!-- nina:slot db.8 -->
- Prisma touched but dba missed → dispatch **dba** now.
