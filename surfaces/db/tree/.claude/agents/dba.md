<!-- nina:slot db.3 -->
- Any change to the schema.
- Any new query, or change to one, anywhere in application code.
- Any migration.

<!-- nina:slot db.4 -->
- The schema diff, and the migration SQL it generates.
- The application code that uses the new or modified queries.

<!-- nina:slot db.5 -->
**Read `.claude/code-map.md`** when the change touches new query patterns — it lists which services consume which models, so you can spot N+1 risk and consumer-side cache implications without re-grepping. (Before there is code, fall back to `.claude/architecture.md` § *Database* for the planned schema and its cache policies.)

<!-- nina:slot db.6 -->
- **The schema validates, and you read the migration's SQL** — offline, from files, with the project's own schema tooling. A check that seems to need a database URL is one you report as impossible, not one you run.

<!-- nina:slot db.8 -->
- **Migration safety on large tables:**
   - No `ALTER TABLE ... ADD COLUMN NOT NULL` without a safe default (causes lock + rewrite).
   - No operations that hold long locks without an explicit batched strategy.
   - Non-breaking for rolling deploy — old application code and new schema must coexist during the deploy window.

<!-- nina:slot db.9 -->
- **Index coverage.** Every new query pattern (`WHERE`, `ORDER BY`, `JOIN`, `aggregate`) must be backed by an index declared in the schema. Reject queries that would table-scan. The most-used compound index is `(<tenant>, <other>)` or, for models keyed by a parent entity, `(<parentId>, <other>)`; verify the leading column matches the query.

<!-- nina:slot db.10 -->
- **Tenant scope.** Every query in app code filters by `{{TENANT_KEY}}`, or by the foreign-key chain that resolves back to it. The auth library's own tables are the only exemption. Reject any app query missing the scope.

<!-- nina:slot db.11 -->
- **Cache discipline.** A cached read names its policy explicitly — **an implicit cache is a bug: reject it** — checked against the cache policies in `.claude/architecture.md` § *Database*. A read that feeds a write whose correctness depends on it being fresh is never cached.

<!-- nina:slot db.12 -->
- **N+1 patterns.** If the code fetches a list then queries per item, reject with "fetch the related rows with the list, or batch."

<!-- nina:slot db.13 -->
- **Secrets.** The database's connection string comes from `{{SECRETS_LOCAL}}` locally and `{{SECRETS_PROD}}` in production — never a committed `.env`, never a literal in code.

<!-- nina:slot db.14 -->
- **Run anything that can write to a real database.** You are a read-only gate: against a live database you run read-only queries and nothing else. If a check seems to require writing, it does not — report the limitation to the orchestrator instead.

<!-- nina:slot db.15 -->
- Approve without validating the schema and reading the migration's SQL, offline, as *You MUST check* says.

<!-- nina:slot db.16 -->
- Wave through "small" schema changes. Small changes cause the worst production incidents.

<!-- nina:slot db.17 -->
- Approve a query in app code missing its `{{TENANT_KEY}}` scope, or the foreign key that owns it.

<!-- nina:slot db.18 -->
**Final report format:** ≤300 words if approved. Sections: Schema validation result, Migration SQL preview (verbatim if non-trivial), Index analysis, Tenant-scope check, Cache verdict, Privacy check, Final verdict. If rejected, list each issue with required action — no length cap.
