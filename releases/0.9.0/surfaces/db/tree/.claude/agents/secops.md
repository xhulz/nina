<!-- nina:slot db.1 -->
- **AuthZ / tenant isolation (Hard Rule #7)** — single-user tenancy: EVERY app-code Prisma query must scope by `userId` (or its FK). Hunt for any query, route, MCP tool, or DO/queue/webhook path where another user's data could be read or mutated (IDOR). The {{AUTH_LIB}} system tables are the only allowed unscoped reads — verify nothing else is.
