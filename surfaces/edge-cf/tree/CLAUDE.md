<!-- nina:slot edge-cf.1 -->

### Cloudflare plugin skills — USE THEM

The `cloudflare@cloudflare` plugin is installed at user scope and exposes skills that retrieve the **current** Cloudflare docs at invocation time. Pre-trained knowledge of Workers / Wrangler / DO / Queues / Cron APIs is stale — prefer the skill over recalling from memory.

<!-- nina:slot edge-cf.2 -->
| Write or review code under `{{API_DIR}}/**` (routes, services, middleware, webhook receivers, queue consumers) | `cloudflare:workers-best-practices` | catches floating promises, global-state misuse, missing `waitUntil`, streaming pitfalls |

<!-- nina:slot edge-cf.3 -->
| Touch `{{API_DIR}}/src/do/**` or any Durable Object call site | `cloudflare:durable-objects` | covers RPC, alarms, WebSocket, SQLite storage, lifecycle — DO API surface drifts fast |

<!-- nina:slot edge-cf.4 -->
| Touch `{{API_DIR}}/src/queues/**`, R2/KV usage | `cloudflare:cloudflare` | Queues, R2, KV decision tree |

<!-- nina:slot edge-cf.5 -->
| Author or modify `wrangler.toml` / `wrangler.jsonc` / run any `wrangler` CLI command | `cloudflare:wrangler` | CLI flags + config fields churn between minor versions |

<!-- nina:slot edge-cf.6 -->
| Run the **devops** deploy stage | `cloudflare:wrangler` (+ `cloudflare:cloudflare` for R2/KV/Queues/DO bindings) | deploy flags and binding config churn between versions |

<!-- nina:slot edge-cf.7 -->

The plugin's other skills — `cloudflare:agents-sdk`, `cloudflare:sandbox-sdk`, `cloudflare:cloudflare-email-service` — apply only where {{PROJECT}} adopts what they cover: an agent runtime, untrusted code execution, sending mail.

**Wrangler calls out on its own.** Wrangler 4 checks npm for a newer version whenever it prints its banner, a warning or an error, honouring no opt-out, and sends telemetry unless told not to. Every run of it, or of a process that loads it (`getPlatformProxy`), sets `WRANGLER_HIDE_BANNER=true npm_registry=http://127.0.0.1:9 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false` — `npm_registry`, since wrangler reads it through `rc("npm")`, which strips the `npm_` prefix, so `npm_config_registry` sets nothing — and the wrangler config says `send_metrics: false`. The project's own scripts that start wrangler set them, so no run depends on a stage remembering them and no task runner drops them. A run that prints "update available" reached the network: its report says so.<!-- nina:why --> Learned three times in the third project: a dba's "local only" migration, a reviewer's typecheck and an implementer's turbo run each printed "update available", and the registry variable the lesson first named was the one wrangler does not read.<!-- /nina:why -->

<!-- nina:slot edge-cf.8 -->
10. **Secrets in `{{SECRETS_LOCAL}}` for local dev, `{{SECRETS_PROD}}` for production.** Never `.env` committed. `nodejs_compat` is required in the `compatibility_flags` of the wrangler config (`wrangler.jsonc` or `wrangler.toml`) for any database client that runs at the edge.
