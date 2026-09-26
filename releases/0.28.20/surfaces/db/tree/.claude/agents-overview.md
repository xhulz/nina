<!-- nina:slot db.1 -->
- **DBA guardrail** → Prisma / Postgres is the surface where a bad change causes hard-to-reverse damage. Schema mistakes, missing indexes, cache on reads that feed a correctness-critical write, missing `userId` scope — all caught here.

<!-- nina:slot db.2 -->
| **dba** | Mandatory gate on Prisma changes and new queries | `.claude/agents/dba.md` |
