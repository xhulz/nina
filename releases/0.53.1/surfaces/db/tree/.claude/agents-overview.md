<!-- nina:slot db.1 -->
- **DBA guardrail** → the database is the surface where a bad change causes hard-to-reverse damage. Schema mistakes, missing indexes, cache on reads that feed a correctness-critical write, missing tenant scope — all caught here.

<!-- nina:slot db.2 -->
| **dba** | Mandatory gate on schema changes, migrations and new queries | `.claude/agents/dba.md` |
