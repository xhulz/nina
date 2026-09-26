<!-- nina:slot db.1 -->
| `prisma-client-api` | a new or changed Prisma query |

<!-- nina:slot db.2 -->
- **If Prisma was touched anywhere in the diff: name `dba` on your Gates line.** Its approval is what a schema or query change needs; yours does not stand in for it.

<!-- nina:slot db.3 -->
- Check for **single-user tenant scoping** in every new Prisma query in app code: the `where` clause must include `userId` (or its model-specific FK equivalent). No "global" queries except the {{AUTH_LIB}} system tables. Missing scope = `REJECTED`.

<!-- nina:slot db.4 -->
- Check for N+1 queries when the DB layer was touched.

<!-- nina:slot db.5 -->
- **tenant-and-privacy** — `userId` in every app query ({{AUTH_LIB}} tables are the only exemption);
  no PII or secrets in logs; no cross-tenant read
  or write reachable through a route, an MCP tool, a webhook, or an RPC between services.

<!-- nina:slot db.6 -->
- `{{DB_PKG}}/prisma/schema.prisma` touched (Prisma migration in play)

<!-- nina:slot db.7 -->
- Leave `dba` off your Gates line on a Prisma change "because it seems fine."

<!-- nina:slot db.8 -->
- Prisma touched and `dba` not dispatched → name it on your Gates line; the orchestrator sends it.
