<!-- nina:slot db.3 -->
| **ANY schema change, migration or new query** | **+ dba beside the reviewer** |

<!-- nina:slot db.4 -->
- **dba** → mandatory gate on schema changes, migrations, and new queries

<!-- nina:slot db.5 -->
2. **Every schema change, migration and new query goes through the dba subagent.** No exceptions. It runs beside the reviewer, which names it on its Gates line, and `qa` does not go out without its `APPROVED`.

<!-- nina:slot db.6 -->
6. **A cached read names its cache policy, and a read that feeds a write whose correctness depends on it being fresh is never cached.** An implicit cache is a bug, and a stale row contaminates every decision made from it. A write invalidates what it made stale.

<!-- nina:slot db.7 -->
7. **Tenant isolation is enforced in the data layer.** Every query in app code filters by `{{TENANT_KEY}}`, or reaches it through the model's foreign keys. No "global" queries except the auth library's own tables. Reviewer rejects any query missing the scope.

<!-- nina:slot db.8 -->
- **the database**: the schema, a migration, or a query
