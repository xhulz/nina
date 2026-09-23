<!-- nina:slot edge-cf.1 -->
| `cloudflare:workers-best-practices` | `{{API_DIR}}/**` — routes, services, middleware, queue handlers |

<!-- nina:slot edge-cf.2 -->
| `cloudflare:durable-objects` | `{{API_DIR}}/src/do/**` or any DO call site |

<!-- nina:slot edge-cf.3 -->
| `cloudflare:cloudflare` | Queues, R2 or KV |

<!-- nina:slot edge-cf.4 -->
| `cloudflare:wrangler` | `wrangler.toml` or any wrangler command |

<!-- nina:slot edge-cf.5 -->
14. **Cloudflare skill flag** — if the spec touches `{{API_DIR}}/**` (Hono routes/services/queue handlers), the per-account Durable Object, Queues, R2/KV, or `wrangler` config, name which `cloudflare:*` plugin skill the implementer must consult (`cloudflare:workers-best-practices`, `cloudflare:durable-objects`, `cloudflare:cloudflare`, `cloudflare:wrangler`), or state why none applies. Retrieval beats recall — the reviewer rejects a spec that touches these surfaces without naming the skill.
