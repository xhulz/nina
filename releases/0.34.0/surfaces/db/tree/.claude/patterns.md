<!-- nina:slot db.2 -->
- Routes must NOT import query functions (`list*`, `find*`, `get*`, `upsert*`, `delete*`) from `{{DB_PKG_NAME}}` — only its client and its error classes.

<!-- nina:slot db.4 -->
- **Every service query filters by `{{TENANT_KEY}}` (tenant scope).** Missing scope = automatic `REJECTED`.

<!-- nina:slot db.5 -->

---

## Database conventions (enforced by the dba subagent)

- **A cached read names its policy, and a read that feeds a write whose correctness depends on it being fresh is NEVER cached.** A stale row contaminates the decision made from it. Hard reject in dba review.
- **Every query in app code filters by `{{TENANT_KEY}}`** (or reaches it through the model's foreign keys). Tenant isolation is in the data layer. The auth library's own tables are the only exemption.
- Migrations reviewed by **dba** for: non-blocking on large tables, index coverage for new query patterns, backward compatibility during rolling deploy.
- N+1 queries are a bug.

<!-- nina:slot db.6 -->
- A real database, never a mock of its client.
