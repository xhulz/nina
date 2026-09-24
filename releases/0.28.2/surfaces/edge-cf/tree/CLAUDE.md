<!-- nina:slot edge-cf.1 -->

### Cloudflare plugin skills — USE THEM

The `cloudflare@cloudflare` plugin is installed at user scope and exposes skills that retrieve the **current** Cloudflare docs at invocation time. Pre-trained knowledge of Workers / Wrangler / DO / Queues / Cron APIs is stale — prefer the skill over recalling from memory.

<!-- nina:slot edge-cf.2 -->
| Write or review code under `{{API_DIR}}/**` (Hono routes, services, middleware, webhook receivers, queue consumers) | `cloudflare:workers-best-practices` | catches floating promises, global-state misuse, missing `waitUntil`, streaming pitfalls |

<!-- nina:slot edge-cf.3 -->
| Touch `{{API_DIR}}/src/do/**` or any Durable Object call site | `cloudflare:durable-objects` | covers RPC, alarms, WebSocket, SQLite storage, lifecycle — DO API surface drifts fast |

<!-- nina:slot edge-cf.4 -->
| Touch `{{API_DIR}}/src/queues/**`, R2/KV usage | `cloudflare:cloudflare` | Queues, R2, KV decision tree |

<!-- nina:slot edge-cf.5 -->
| Author or modify `wrangler.toml` / `wrangler.jsonc` / run any `wrangler` CLI command | `cloudflare:wrangler` | CLI flags + config fields churn between minor versions |

<!-- nina:slot edge-cf.6 -->
| Run the **devops** deploy stage | `cloudflare:wrangler` (+ `cloudflare:cloudflare` for R2/KV/Queues/DO bindings) | deploy flags and binding config churn between versions |

<!-- nina:slot edge-cf.7 -->

Skills NOT relevant to {{PROJECT}} (skip them): `cloudflare:agents-sdk` (no agent runtime), `cloudflare:sandbox-sdk` (no untrusted code execution), `cloudflare:cloudflare-email-service` ({{AUTH_LIB}} handles magic-link email).

<!-- nina:slot edge-cf.8 -->
10. **Secrets in `{{SECRETS_LOCAL}}` for local dev, `{{SECRETS_PROD}}` for production.** Never `.env` committed. `compatibility_flags = ["nodejs_compat"]` is required in `wrangler.toml` for any database client that runs at the edge.
