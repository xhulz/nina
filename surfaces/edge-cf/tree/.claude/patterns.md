<!-- nina:slot edge-cf.1 -->

---

## Secrets

- **Wrangler secrets** for Workers (`{{SECRETS_PROD}} X`). Never `.env` committed.
- **Local dev:** `{{SECRETS_LOCAL}}` (gitignored).

<!-- nina:slot edge-cf.2 -->
- `compatibility_flags = ["nodejs_compat"]` in `wrangler.toml` is required for a database client that runs at the edge.

<!-- nina:slot edge-cf.3 -->
- **Miniflare** for Worker integration tests.

<!-- nina:slot edge-cf.4 -->
- **Miniflare** for Worker tests — the real Cloudflare runtime, no mocks.
