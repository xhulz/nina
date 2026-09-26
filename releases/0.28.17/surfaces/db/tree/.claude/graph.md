<!-- nina:slot db.1 -->
- `dba` — gate: runs when the schema, a migration or a query is touched

<!-- nina:slot db.2 -->
- `implementer` → `dba` on `DIFF-READY` — the diff touches the schema, a migration or a query
- `dba` → `reviewer` on `APPROVED`
- `dba` → `implementer` on `REJECTED` — a query or schema change in the diff is unsafe · max 2
- `dba` → `architect` on `REJECTED` — the spec's migration or data design is unsafe · max 2
