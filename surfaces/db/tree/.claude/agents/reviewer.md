<!-- nina:slot db.2 -->
- **If the schema, a migration or a query was touched anywhere in the diff: name `dba` on your Gates line.** Its approval is what a database change needs; yours does not stand in for it.

<!-- nina:slot db.3 -->
- Check for **tenant scoping** in every new query in app code: it filters by `{{TENANT_KEY}}`, or reaches it through the model's foreign keys. No "global" queries except the auth library's own tables. Missing scope = `REJECTED`.

<!-- nina:slot db.4 -->
- Check for N+1 queries when the DB layer was touched.

<!-- nina:slot db.5 -->
- **tenant-and-privacy** — `{{TENANT_KEY}}` in every app query (the auth library's own tables are the only exemption);
  no PII or secrets in logs; no cross-tenant read
  or write reachable through a route, an MCP tool, a webhook, or an RPC between services.

<!-- nina:slot db.6 -->
- The schema touched (a migration in play)

<!-- nina:slot db.7 -->
- Leave `dba` off your Gates line on a database change "because it seems fine."

<!-- nina:slot db.8 -->
- Schema or query touched and `dba` not dispatched → name it on your Gates line; the orchestrator sends it.
