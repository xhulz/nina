<!-- nina:slot edge-cf.1 -->
| `{{API_DIR}}/**` Hono routes / services / middleware / queue handlers | `cloudflare:workers-best-practices` |

<!-- nina:slot edge-cf.2 -->
| `{{API_DIR}}/src/do/**` or any DO call site | `cloudflare:durable-objects` |

<!-- nina:slot edge-cf.3 -->
| `{{API_DIR}}/src/queues/**`, R2/KV | `cloudflare:cloudflare` |

<!-- nina:slot edge-cf.4 -->
| `wrangler.toml` / `wrangler.jsonc` / any wrangler CLI | `cloudflare:wrangler` |

<!-- nina:slot edge-cf.5 -->
| **devops** running any wrangler command or deploy | **`cloudflare:wrangler`** (+ `cloudflare:cloudflare` for R2/KV/Queues/DO bindings) |

<!-- nina:slot edge-cf.6 -->

Irrelevant to {{PROJECT}} (do NOT invoke): `cloudflare:agents-sdk`, `cloudflare:sandbox-sdk`, `cloudflare:cloudflare-email-service`.

<!-- nina:slot edge-cf.7 -->
The `cloudflare@cloudflare` plugin (user-scope) is where this project's skills come from.
