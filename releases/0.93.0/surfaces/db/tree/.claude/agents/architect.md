<!-- nina:slot db.2 -->
- **Tenant-scope impact** — state where `{{TENANT_KEY}}` is enforced. Every new query in app code filters by it, or reaches it through the model's foreign keys; only the auth library's own tables are exempt.

<!-- nina:slot db.3 -->
- **Database flag** — if the schema or a new query is touched, mark **"DBA REQUIRED"** prominently at the top of the spec, and name each new read's cache policy, or **`NO_CACHE`** for a read that feeds a write whose correctness depends on it being fresh — a stale row contaminates every decision made from it.
