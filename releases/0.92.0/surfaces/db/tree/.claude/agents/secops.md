<!-- nina:slot db.1 -->
- **AuthZ / tenant isolation (Hard Rule #7)** — EVERY query in app code scopes by `{{TENANT_KEY}}` (or its foreign key). Hunt for any query, route, MCP tool, or queue, webhook or background path where another tenant's data could be read or mutated (IDOR). The auth library's own tables are the only allowed unscoped reads — verify nothing else is.
